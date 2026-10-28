import { createServer, type Server } from 'node:http'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createMicrocityApp } from '../server/app.ts'
import { createDatabase } from '../server/db.ts'
import { analyseNeeds } from '../src/domain/analysis/index.ts'
import { istDateKey } from '../src/lib/time.ts'
import type { AttendanceRecord, UserRole, WorkspacePayload } from '../src/domain/types.ts'

interface RunningApp {
  url: string
  server: Server
  close: () => Promise<void>
}

interface TestSession {
  cookie: string
  userId: string
}

async function startApp(): Promise<RunningApp> {
  const db = createDatabase(':memory:', true)
  const app = createMicrocityApp({ db, env: {} })
  const server = createServer((req, res) => {
    void app
      .handle(req, res)
      .then((handled) => {
        if (!handled && !res.headersSent) {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Not found' }))
        }
      })
      .catch((error: unknown) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
        }
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'failed' }))
      })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The test server did not bind a port.')
  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

async function signIn(app: RunningApp, username: string, role: UserRole, collegeId = 'clg-bv'): Promise<TestSession> {
  const response = await fetch(`${app.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: `${username}-pass`, collegeId, role }),
  })
  const payload = (await response.json()) as { session?: { user: { id: string } } }
  assert.equal(response.status, 200, `sign-in failed for ${username}`)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  return { cookie, userId: payload.session?.user.id ?? '' }
}

async function loadWorkspace(app: RunningApp, session: TestSession, collegeId = 'clg-bv'): Promise<WorkspacePayload> {
  const response = await fetch(`${app.url}/api/workspace`, {
    headers: { Cookie: session.cookie, 'X-College-Id': collegeId },
  })
  assert.equal(response.status, 200)
  return (await response.json()) as WorkspacePayload
}

async function saveAttendance(
  app: RunningApp,
  session: TestSession | null,
  body: Record<string, unknown>,
  collegeId = 'clg-bv',
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-College-Id': collegeId }
  if (session) headers.Cookie = session.cookie
  const response = await fetch(`${app.url}/api/attendance`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> }
}

function loggableSlotOnPastDate(workspace: WorkspacePayload) {
  const slot = workspace.dataset.timetableSlots.find(
    (item) => item.expectedAttendance !== null && item.expectedAttendance > 0,
  )
  assert.ok(slot, 'the demo timetable should have a session with expected attendance')
  const sessionDate = istDateKey(slot.startsAt)
  assert.ok(sessionDate)
  return { slot, sessionDate }
}

describe('attendance cross-college isolation', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp()
  })
  after(async () => {
    await app.close()
  })

  it('refuses a Vidya Nagar faculty member logging a Foundry Lane slot', async () => {
    const faculty = await signIn(app, 'sample-faculty', 'faculty', 'clg-bv')
    const result = await saveAttendance(app, faculty, {
      slotId: 'tlt-fd-1',
      sessionDate: '2026-10-08',
      present: 5,
      reasons: [],
    })
    assert.ok(result.status === 403 || result.status === 404, `expected 403/404, got ${result.status}`)
    assert.equal(result.status, 404)
  })
})

describe('attendance present validation', () => {
  let app: RunningApp
  let faculty: TestSession
  let slotId: string
  let sessionDate: string
  let enrolled: number

  before(async () => {
    app = await startApp()
    faculty = await signIn(app, 'sample-faculty', 'faculty')
    const workspace = await loadWorkspace(app, faculty)
    const picked = loggableSlotOnPastDate(workspace)
    slotId = picked.slot.id
    sessionDate = picked.sessionDate
    enrolled = picked.slot.expectedAttendance ?? 0
  })
  after(async () => {
    await app.close()
  })

  it('accepts present equal to enrolled', async () => {
    const result = await saveAttendance(app, faculty, { slotId, sessionDate, present: enrolled, reasons: [] })
    assert.equal(result.status, 201)
    assert.equal((result.payload.record as AttendanceRecord).present, enrolled)
  })

  it('rejects present one above enrolled', async () => {
    const result = await saveAttendance(app, faculty, { slotId, sessionDate, present: enrolled + 1, reasons: [] })
    assert.equal(result.status, 422)
    const fieldErrors = result.payload.fieldErrors as Record<string, string> | undefined
    assert.ok(fieldErrors?.present?.includes('Only'))
  })

  it('rejects negative, decimal and non-numeric present values', async () => {
    for (const present of [-1, 12.5, 'twelve', '', null]) {
      const result = await saveAttendance(app, faculty, { slotId, sessionDate, present, reasons: [] })
      assert.equal(result.status, 422, `present ${JSON.stringify(present)} should be rejected`)
    }
  })

  it('rejects a future session date', async () => {
    const result = await saveAttendance(app, faculty, {
      slotId,
      sessionDate: '2099-01-01',
      present: 1,
      reasons: [],
    })
    assert.equal(result.status, 422)
    assert.match(String(result.payload.error), /future date/i)
  })

  it('rejects reasons outside the three allowed values', async () => {
    const result = await saveAttendance(app, faculty, {
      slotId,
      sessionDate,
      present: 1,
      reasons: ['broken_aircon'],
    })
    assert.equal(result.status, 422)
    const fieldErrors = result.payload.fieldErrors as Record<string, string> | undefined
    assert.ok(fieldErrors?.reasons)
  })

  it('refuses an unauthenticated request with 401', async () => {
    const result = await saveAttendance(app, null, { slotId, sessionDate, present: 1, reasons: [] })
    assert.equal(result.status, 401)
  })
})

describe('attendance audit trail', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp()
  })
  after(async () => {
    await app.close()
  })

  it('records who created and who overwrote the record, with timestamps', async () => {
    const faculty = await signIn(app, 'sample-faculty', 'faculty')
    const workspace = await loadWorkspace(app, faculty)
    const { slot, sessionDate } = loggableSlotOnPastDate(workspace)
    const enrolled = slot.expectedAttendance ?? 0

    const created = await saveAttendance(app, faculty, {
      slotId: slot.id,
      sessionDate,
      present: enrolled - 1,
      reasons: [],
    })
    assert.equal(created.status, 201)
    const recordId = (created.payload.record as AttendanceRecord).id

    const updated = await saveAttendance(app, faculty, {
      slotId: slot.id,
      sessionDate,
      present: enrolled - 2,
      reasons: ['too_hot'],
    })
    assert.equal(updated.status, 200)

    const admin = await signIn(app, 'sample-admin', 'admin')
    const adminWorkspace = await loadWorkspace(app, admin)
    const entries = adminWorkspace.audit.filter((entry) => entry.entity === 'attendanceRecords' && entry.entityId === recordId)
    const createEntry = entries.find((entry) => entry.action === 'create')
    const updateEntry = entries.find((entry) => entry.action === 'update')
    assert.ok(createEntry, 'creating attendance must be audited')
    assert.ok(updateEntry, 'overwriting attendance must be audited')
    assert.equal(createEntry.actorName, 'Sample Faculty Member')
    assert.equal(updateEntry.actorName, 'Sample Faculty Member')
    assert.ok(!Number.isNaN(Date.parse(createEntry.at)))
    assert.ok(!Number.isNaN(Date.parse(updateEntry.at)))
  })
})

describe('attendance by administrators', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp()
  })
  after(async () => {
    await app.close()
  })

  it('succeeds for the admin role', async () => {
    const admin = await signIn(app, 'sample-admin', 'admin')
    const workspace = await loadWorkspace(app, admin)
    const { slot, sessionDate } = loggableSlotOnPastDate(workspace)
    const result = await saveAttendance(app, admin, {
      slotId: slot.id,
      sessionDate,
      present: (slot.expectedAttendance ?? 1) - 1,
      reasons: ['room_too_small'],
    })
    assert.equal(result.status, 201)
    assert.equal(result.payload.created, true)
  })
})

describe('attendance changes the Needs and Gaps room row', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp()
  })
  after(async () => {
    await app.close()
  })

  it('moves the room status, not only the average', async () => {
    const faculty = await signIn(app, 'sample-faculty', 'faculty')
    const before = await loadWorkspace(app, faculty)
    const slot = before.dataset.timetableSlots.find((item) => item.id === 'tlt-bv-1')
    assert.ok(slot)
    const sessionDate = istDateKey(slot.startsAt)
    assert.ok(sessionDate)

    const profileOf = (payload: WorkspacePayload) =>
      analyseNeeds(
        payload.dataset.rooms,
        payload.dataset.timetableSlots,
        payload.dataset.buildings,
        payload.dataset.complaints,
        payload.serverTime,
      ).rooms.find((room) => room.roomId === slot.roomId)

    const beforeProfile = profileOf(before)
    assert.ok(beforeProfile)

    const saved = await saveAttendance(app, faculty, {
      slotId: slot.id,
      sessionDate,
      present: 10,
      reasons: [],
    })
    assert.equal(saved.status, 201)

    const after = await loadWorkspace(app, faculty)
    const afterProfile = profileOf(after)
    assert.ok(afterProfile)

    console.log(
      'Needs and Gaps room row before:',
      `${beforeProfile.code}: status=${beforeProfile.status}, score=${beforeProfile.score}, average utilisation=${
        beforeProfile.averageUtilisation === null ? 'missing' : `${Math.round(beforeProfile.averageUtilisation * 100)}%`
      }`,
    )
    console.log(
      'Needs and Gaps room row after:',
      `${afterProfile.code}: status=${afterProfile.status}, score=${afterProfile.score}, average utilisation=${
        afterProfile.averageUtilisation === null ? 'missing' : `${Math.round(afterProfile.averageUtilisation * 100)}%`
      }`,
    )

    assert.notEqual(afterProfile.status, beforeProfile.status, 'the room row status should change with attendance')
    assert.notEqual(afterProfile.score, beforeProfile.score)
  })
})

describe('ticket numbers', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp()
  })
  after(async () => {
    await app.close()
  })

  it('assigns distinct tickets for reports created at the same moment', async () => {
    const student = await signIn(app, 'sample-student', 'student')
    const bodies = ['A', 'B', 'C'].map((letter) => ({
      category: 'Electrical',
      severity: 'medium',
      description: `Test report ${letter}: the corridor light near the lab door is flickering.`,
      buildingId: 'bld-bv-main',
      roomChoice: 'not_sure',
    }))
    const responses = await Promise.all(
      bodies.map((data) =>
        fetch(`${app.url}/api/records/complaints`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: student.cookie, 'X-College-Id': 'clg-bv' },
          body: JSON.stringify({ data }),
        }),
      ),
    )
    const payloads = await Promise.all(responses.map((response) => response.json() as Promise<{ record?: { ticketNumber?: string } }>))
    for (const [index, response] of responses.entries()) {
      assert.equal(response.status, 201, `report ${index} should be created`)
    }
    const tickets = payloads.map((payload) => payload.record?.ticketNumber ?? '')
    for (const ticket of tickets) assert.match(ticket, /^MC-\d{4}$/)
    assert.equal(new Set(tickets).size, tickets.length, `tickets must be unique, got ${tickets.join(', ')}`)
  })
})
