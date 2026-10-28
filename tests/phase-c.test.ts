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

async function signIn(app: RunningApp, username: string, role: UserRole): Promise<TestSession> {
  const response = await fetch(`${app.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: `${username}-pass`,
      collegeId: 'clg-bv',
      role,
    }),
  })
  const payload = (await response.json()) as { session?: { user: { id: string } } }
  assert.equal(response.status, 200, `sign-in failed for ${username}`)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  assert.ok(payload.session?.user.id)
  return { cookie, userId: payload.session.user.id }
}

async function loadWorkspace(app: RunningApp, session: TestSession): Promise<WorkspacePayload> {
  const response = await fetch(`${app.url}/api/workspace`, {
    headers: { Cookie: session.cookie, 'X-College-Id': 'clg-bv' },
  })
  assert.equal(response.status, 200)
  return (await response.json()) as WorkspacePayload
}

async function saveAttendance(
  app: RunningApp,
  session: TestSession,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await fetch(`${app.url}/api/attendance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: session.cookie, 'X-College-Id': 'clg-bv' },
    body: JSON.stringify(body),
  })
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> }
}

function firstLoggableSlot(workspace: WorkspacePayload) {
  const slot = workspace.dataset.timetableSlots.find(
    (item) => item.expectedAttendance !== null && item.expectedAttendance > 0,
  )
  assert.ok(slot, 'the demo timetable should have a session with expected attendance')
  const sessionDate = istDateKey(slot.startsAt)
  assert.ok(sessionDate)
  return { slot, sessionDate }
}

describe('attendance limits', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp()
  })
  after(async () => {
    await app.close()
  })

  it('rejects more present students than the class has enrolled', async () => {
    const faculty = await signIn(app, 'sample-faculty', 'faculty')
    const workspace = await loadWorkspace(app, faculty)
    const { slot, sessionDate } = firstLoggableSlot(workspace)

    const result = await saveAttendance(app, faculty, {
      slotId: slot.id,
      sessionDate,
      present: (slot.expectedAttendance ?? 0) + 1,
      reasons: [],
    })

    assert.equal(result.status, 422)
    const fieldErrors = result.payload.fieldErrors as Record<string, string> | undefined
    assert.ok(fieldErrors?.present?.includes('Only'))
    const after = await loadWorkspace(app, faculty)
    assert.equal(after.dataset.attendanceRecords.length, 0)
  })
})

describe('attendance upsert', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp()
  })
  after(async () => {
    await app.close()
  })

  it('updates the existing record for the same slot and date', async () => {
    const faculty = await signIn(app, 'sample-faculty', 'faculty')
    const workspace = await loadWorkspace(app, faculty)
    const { slot, sessionDate } = firstLoggableSlot(workspace)
    const enrolled = slot.expectedAttendance ?? 0

    const first = await saveAttendance(app, faculty, {
      slotId: slot.id,
      sessionDate,
      present: enrolled - 1,
      reasons: ['too_hot'],
    })
    assert.equal(first.status, 201)
    assert.equal(first.payload.created, true)
    const firstRecord = first.payload.record as AttendanceRecord

    const second = await saveAttendance(app, faculty, {
      slotId: slot.id,
      sessionDate,
      present: enrolled - 2,
      reasons: ['room_too_small'],
    })
    assert.equal(second.status, 200)
    assert.equal(second.payload.created, false)
    const secondRecord = second.payload.record as AttendanceRecord
    assert.equal(secondRecord.id, firstRecord.id)
    assert.equal(secondRecord.present, enrolled - 2)

    const after = await loadWorkspace(app, faculty)
    const matching = after.dataset.attendanceRecords.filter(
      (record) => record.slotId === slot.id && record.sessionDate === sessionDate,
    )
    assert.equal(matching.length, 1, 'only one attendance record should exist for the session')
    assert.deepEqual(matching[0]?.reasons, ['room_too_small'])
    const booked = after.dataset.timetableSlots.find((item) => item.id === slot.id)
    assert.equal(booked?.attendance, enrolled - 2)
  })
})

describe('attendance permissions', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp()
  })
  after(async () => {
    await app.close()
  })

  it('refuses students and maintenance staff with 403', async () => {
    const faculty = await signIn(app, 'sample-faculty', 'faculty')
    const workspace = await loadWorkspace(app, faculty)
    const { slot, sessionDate } = firstLoggableSlot(workspace)

    for (const [username, role] of [
      ['sample-student', 'student'],
      ['sample-maintenance', 'maintenance'],
    ] as const) {
      const session = await signIn(app, username, role)
      const result = await saveAttendance(app, session, {
        slotId: slot.id,
        sessionDate,
        present: 1,
        reasons: [],
      })
      assert.equal(result.status, 403, `${role} should not log attendance`)
      assert.equal(result.payload.error, 'Only faculty and administrators can log attendance.')
    }
  })
})

describe('attendance feeds utilisation', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp()
  })
  after(async () => {
    await app.close()
  })

  it('changes the room utilisation after attendance is saved', async () => {
    const faculty = await signIn(app, 'sample-faculty', 'faculty')
    const before = await loadWorkspace(app, faculty)
    const slot = before.dataset.timetableSlots.find(
      (item) => item.id === 'tlt-bv-1' && item.expectedAttendance !== null,
    )
    assert.ok(slot, 'expected the seeded BIM lecture')
    const sessionDate = istDateKey(slot.startsAt)
    assert.equal(sessionDate, '2026-10-05')

    const beforeRoom = analyseNeeds(
      before.dataset.rooms,
      before.dataset.timetableSlots,
      before.dataset.buildings,
      before.dataset.complaints,
      before.serverTime,
    ).rooms.find((room) => room.roomId === slot.roomId)
    assert.ok(beforeRoom)
    assert.ok(beforeRoom.averageUtilisation !== null)

    const saved = await saveAttendance(app, faculty, {
      slotId: slot.id,
      sessionDate,
      present: 10,
      reasons: ['room_too_small', 'too_hot'],
    })
    assert.equal(saved.status, 201)

    const after = await loadWorkspace(app, faculty)
    const afterRoom = analyseNeeds(
      after.dataset.rooms,
      after.dataset.timetableSlots,
      after.dataset.buildings,
      after.dataset.complaints,
      after.serverTime,
    ).rooms.find((room) => room.roomId === slot.roomId)
    assert.ok(afterRoom)
    assert.notEqual(afterRoom.averageUtilisation, beforeRoom.averageUtilisation)

    const assessedSlot = afterRoom.slots.find((item) => item.slotId === slot.id)
    assert.ok(assessedSlot)
    assert.equal(assessedSlot.attendance, 10)
    assert.equal(assessedSlot.utilisation, 10 / 30)
  })
})

describe('student report visibility', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp()
  })
  after(async () => {
    await app.close()
  })

  it('returns only the signed-in student’s own reports', async () => {
    const admin = await signIn(app, 'sample-admin', 'admin')
    const allReports = await loadWorkspace(app, admin)
    const student = await signIn(app, 'sample-student', 'student')
    const mine = await loadWorkspace(app, student)

    assert.ok(mine.dataset.complaints.length > 0)
    assert.ok(mine.dataset.complaints.every((complaint) => complaint.reporterId === student.userId))
    const someoneElse = allReports.dataset.complaints.find(
      (complaint) => complaint.reporterId !== student.userId,
    )
    assert.ok(someoneElse, 'the demo data should contain reports from other people')
    assert.ok(!mine.dataset.complaints.some((complaint) => complaint.id === someoneElse.id))
  })
})
