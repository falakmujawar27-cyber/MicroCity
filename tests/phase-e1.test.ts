/**
 * Phase E1 — Estates/Admin shell, Overview and Needs and Gaps.
 *
 * Covers the Part 0 repair outcomes (Fixed stays Fixed, closed without repair
 * needs a reason, estates resolution notes, photo access, audit trail), the
 * five-item staff shell with administration kept off the sidebar and refused
 * server-side, and the five-category Needs and Gaps row built only from
 * recorded data. No test from an earlier phase is deleted.
 */
import { createServer, type Server } from 'node:http'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createMicrocityApp } from '../server/app.ts'
import { createDatabase } from '../server/db.ts'
import { analyseWorkspace, buildNeedsCategories } from '../src/domain/analysis/index.ts'
import { CLOSED_WITHOUT_REPAIR, REPORT_STEPS, reportSteps } from '../src/domain/progress.ts'
import {
  dashboardMoreNavFor,
  dashboardNavFor,
  dashboardSecondaryNavFor,
} from '../src/components/dashboard/nav.ts'
import { istDateKey } from '../src/lib/time.ts'
import type { Complaint, DatasetSources, UserRole, WorkspacePayload } from '../src/domain/types.ts'

interface RunningApp {
  url: string
  server: Server
  close: () => Promise<void>
}

interface TestSession {
  cookie: string
  userId: string
  username: string
}

const PNG_8PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGP8z8Dwn4EJwIwUtGE9ADIBAwMBgYEDAB9sBQl0cVjSAAAAAElFTkSuQmCC'
const PNG_8PX_BYTES = Buffer.from(PNG_8PX.split(',')[1], 'base64').length
const RESOLUTION_NOTE = 'Replaced the projector power cable and tested it for a full hour.'
const CLOSE_REASON = 'Replacement part is no longer available, so the unit will be removed instead.'

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

async function signIn(
  app: RunningApp,
  username: string,
  role: UserRole,
  collegeId = 'clg-bv',
): Promise<TestSession> {
  const response = await fetch(`${app.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: `${username}-pass`, collegeId, role }),
  })
  const payload = (await response.json()) as { session?: { user: { id: string } } }
  assert.equal(response.status, 200, `sign-in failed for ${username}`)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  return { cookie, userId: payload.session?.user.id ?? '', username }
}

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  session?: TestSession | null
  body?: unknown
  collegeId?: string | null
}

async function call<T = Record<string, unknown>>(
  app: RunningApp,
  path: string,
  options: CallOptions = {},
): Promise<{ status: number; payload: T }> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.collegeId) headers['X-College-Id'] = options.collegeId
  if (options.session) headers.Cookie = options.session.cookie
  const response = await fetch(`${app.url}/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  let payload: Record<string, unknown> = {}
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>
    } catch {
      payload = { raw: text }
    }
  }
  return { status: response.status, payload: payload as T }
}

async function loadWorkspace(app: RunningApp, session: TestSession, collegeId = 'clg-bv'): Promise<WorkspacePayload> {
  const response = await fetch(`${app.url}/api/workspace`, {
    headers: { Cookie: session.cookie, 'X-College-Id': collegeId },
  })
  assert.equal(response.status, 200)
  return (await response.json()) as WorkspacePayload
}

async function createComplaint(
  app: RunningApp,
  session: TestSession,
  overrides: Record<string, unknown> = {},
): Promise<Complaint> {
  const result = await call<{ record: Complaint; error?: string }>(app, '/records/complaints', {
    method: 'POST',
    session,
    body: {
      data: {
        category: 'Electrical',
        severity: 'high',
        description: 'The projector in the lecture hall cuts out after about ten minutes of use.',
        buildingId: 'bld-bv-main',
        roomChoice: 'room',
        roomId: 'rm-bv-101',
        peopleAffected: 12,
        ...overrides,
      },
    },
  })
  assert.equal(result.status, 201, `complaint should be created: ${JSON.stringify(result.payload)}`)
  return result.payload.record
}

async function assignTo(app: RunningApp, estates: TestSession, complaintId: string, userId: string): Promise<void> {
  const result = await call<{ error?: string }>(app, `/records/complaints/${complaintId}`, {
    method: 'PATCH',
    session: estates,
    body: { data: { assignedToUserId: userId } },
  })
  assert.equal(result.status, 200, `assignment should succeed: ${JSON.stringify(result.payload)}`)
}

async function complaintPatch(
  app: RunningApp,
  session: TestSession,
  id: string,
  data: Record<string, unknown>,
): Promise<{ status: number; payload: { error?: string; record?: Complaint } }> {
  return call(app, `/records/complaints/${id}`, { method: 'PATCH', session, body: { data } })
}

async function jobMove(
  app: RunningApp,
  session: TestSession,
  jobId: string,
  move: 'start' | 'complete',
  body: Record<string, unknown> = {},
): Promise<{ status: number }> {
  const result = await call(app, `/jobs/${jobId}/${move}`, { method: 'POST', session, body })
  return { status: result.status }
}

async function photoResponse(
  app: RunningApp,
  session: TestSession | null,
  id: string,
  kind: 'report' | 'completion',
  collegeId = 'clg-bv',
): Promise<{ status: number; bytes: number }> {
  const response = await fetch(
    `${app.url}/api/complaints/${encodeURIComponent(id)}/photo?kind=${kind}&collegeId=${encodeURIComponent(collegeId)}`,
    { headers: session ? { Cookie: session.cookie } : {} },
  )
  const buffer = Buffer.from(await response.arrayBuffer())
  return { status: response.status, bytes: buffer.length }
}

async function saveAttendance(
  app: RunningApp,
  session: TestSession,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await fetch(`${app.url}/api/attendance`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-College-Id': 'clg-bv',
      Cookie: session.cookie,
    },
    body: JSON.stringify(body),
  })
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> }
}

/* ------------------------------------------------------------------ */
/* Part 0 — repair outcomes, photos and the audit trail               */
/* ------------------------------------------------------------------ */

describe('E1 Part 0 repair outcomes', () => {
  let app: RunningApp
  let student: TestSession
  let estates: TestSession
  let technician: TestSession

  before(async () => {
    app = await startApp()
    student = await signIn(app, 'sample-student', 'student')
    estates = await signIn(app, 'sample-estates', 'estates')
    technician = await signIn(app, 'sample-maintenance', 'maintenance')
  })
  after(async () => {
    await app.close()
  })

  it('keeps Fixed when a repaired report is filed closed, and shows what was done', async () => {
    const complaint = await createComplaint(app, student, { severity: 'low', peopleAffected: 4 })
    await assignTo(app, estates, complaint.id, technician.userId)
    assert.equal((await jobMove(app, technician, complaint.id, 'start')).status, 200)
    assert.equal(
      (await jobMove(app, technician, complaint.id, 'complete', { note: RESOLUTION_NOTE })).status,
      200,
    )

    const closed = await complaintPatch(app, estates, complaint.id, { status: 'closed' })
    assert.equal(closed.status, 200, JSON.stringify(closed.payload))

    const workspace = await loadWorkspace(app, student)
    const record = workspace.dataset.complaints.find((item) => item.id === complaint.id)
    assert.ok(record)
    assert.equal(record.status, 'closed')
    assert.ok(record.resolvedAt, 'a repaired report keeps its resolution time after filing closed')
    assert.equal(record.closedReason ?? null, null)
    assert.equal(record.completionNote, RESOLUTION_NOTE)
    assert.deepEqual(reportSteps(record), REPORT_STEPS)
    assert.equal(reportSteps(record)[3], 'Fixed', 'the student still reads Fixed')
    assert.notEqual(reportSteps(record)[3], CLOSED_WITHOUT_REPAIR)

    const card = await readFile(new URL('../src/components/dashboard/ReportCard.tsx', import.meta.url), 'utf8')
    assert.match(card, /What was done/, 'the repaired note is shown as What was done')
    assert.match(card, /wasRepaired/)
  })

  it('requires a reason and shows Closed without repair for a never-repaired job', async () => {
    const complaint = await createComplaint(app, student, { severity: 'medium', peopleAffected: 6 })

    const noReason = await complaintPatch(app, estates, complaint.id, { status: 'closed' })
    assert.equal(noReason.status, 422)
    assert.match(String(noReason.payload.error), /why this report is being closed/i)

    const shortReason = await complaintPatch(app, estates, complaint.id, { status: 'closed', note: 'No part' })
    assert.equal(shortReason.status, 422, 'a reason shorter than 10 characters is refused')

    const closed = await complaintPatch(app, estates, complaint.id, { status: 'closed', note: CLOSE_REASON })
    assert.equal(closed.status, 200, JSON.stringify(closed.payload))

    const workspace = await loadWorkspace(app, student)
    const record = workspace.dataset.complaints.find((item) => item.id === complaint.id)
    assert.ok(record)
    assert.equal(record.status, 'closed')
    assert.equal(record.resolvedAt, null)
    assert.match(String(record.closedReason), /replacement part/i)
    assert.deepEqual(reportSteps(record), [...REPORT_STEPS.slice(0, 3), CLOSED_WITHOUT_REPAIR])
    assert.notEqual(reportSteps(record)[3], 'Fixed')
  })

  it('requires and stores an estates resolution note for a repair', async () => {
    const complaint = await createComplaint(app, student, { severity: 'medium', peopleAffected: 7 })

    const noNote = await complaintPatch(app, estates, complaint.id, { status: 'resolved' })
    assert.equal(noNote.status, 422)
    assert.match(String(noNote.payload.error), /what was done/i)

    const resolved = await complaintPatch(app, estates, complaint.id, {
      status: 'resolved',
      note: RESOLUTION_NOTE,
    })
    assert.equal(resolved.status, 200, JSON.stringify(resolved.payload))

    const workspace = await loadWorkspace(app, student)
    const record = workspace.dataset.complaints.find((item) => item.id === complaint.id)
    assert.ok(record)
    assert.equal(record.status, 'resolved')
    assert.equal(record.completionNote, RESOLUTION_NOTE, 'the resolution note is shown as What was done')
    assert.ok(record.resolvedAt)
    assert.equal(reportSteps(record)[3], 'Fixed')
  })

  it('refuses the photo to faculty who is neither the reporter nor staff', async () => {
    const complaint = await createComplaint(app, student, {
      severity: 'low',
      peopleAffected: 3,
      photoName: 'before.png',
      photoDataUrl: PNG_8PX,
    })
    const faculty = await signIn(app, 'sample-faculty', 'faculty')

    const refused = await photoResponse(app, faculty, complaint.id, 'report')
    console.log('faculty photo access:', refused.status)
    assert.equal(refused.status, 403, 'faculty neither raised nor handles this report')

    const reporter = await photoResponse(app, student, complaint.id, 'report')
    assert.equal(reporter.status, 200)
    assert.equal(reporter.bytes, PNG_8PX_BYTES)

    const staff = await photoResponse(app, estates, complaint.id, 'report')
    assert.equal(staff.status, 200)
  })

  it('writes who, when, from and to for every estates status transition', async () => {
    const complaint = await createComplaint(app, student, { severity: 'low', peopleAffected: 2 })
    const transitions: Array<{ to: string; note?: string }> = [
      { to: 'in_progress' },
      { to: 'open' },
      { to: 'resolved', note: 'Replaced a faulty socket and tested the circuit.' },
      { to: 'in_progress', note: 'Reopened to check the same circuit.' },
      { to: 'resolved', note: 'Circuit checked again and left in working order.' },
      { to: 'closed' },
      { to: 'open' },
      { to: 'in_progress' },
      { to: 'closed', note: 'Duplicate of the repair already completed this month.' },
    ]
    let from = 'open'
    for (const step of transitions) {
      const result = await complaintPatch(app, estates, complaint.id, {
        status: step.to,
        ...(step.note ? { note: step.note } : {}),
      })
      assert.equal(result.status, 200, `${from} -> ${step.to}: ${JSON.stringify(result.payload)}`)

      const workspace = await loadWorkspace(app, estates)
      const entry = workspace.audit.find(
        (item) =>
          item.entityId === complaint.id &&
          item.detail.includes(`from ${from} to ${step.to}`),
      )
      assert.ok(entry, `audit must record ${from} -> ${step.to}`)
      assert.equal(entry.actorName, 'Sample Estates Officer')
      assert.ok(!Number.isNaN(Date.parse(entry.at)), 'the audit entry carries a server timestamp')
      from = step.to
    }

    const workspace = await loadWorkspace(app, estates)
    const history = workspace.dataset.complaintUpdates.filter(
      (item) => item.complaintId === complaint.id && item.kind === 'status',
    )
    assert.equal(history.length, transitions.length, 'one history entry per transition')
    assert.ok(history.every((item) => item.fromStatus && item.toStatus))
  })

  it('accepts people affected as any whole number from zero, with no upper bound', async () => {
    const zero = await createComplaint(app, student, { peopleAffected: 0 })
    assert.equal(zero.peopleAffected, 0)

    const negative = await call<{ error?: string }>(app, '/records/complaints', {
      method: 'POST',
      session: student,
      body: {
        data: {
          category: 'Electrical',
          severity: 'low',
          description: 'A socket cover is loose near the corridor door.',
          buildingId: 'bld-bv-main',
          roomChoice: 'room',
          roomId: 'rm-bv-101',
          peopleAffected: -1,
        },
      },
    })
    assert.equal(negative.status, 422)

    const fraction = await call<{ error?: string }>(app, '/records/complaints', {
      method: 'POST',
      session: student,
      body: {
        data: {
          category: 'Electrical',
          severity: 'low',
          description: 'A socket cover is loose near the corridor door.',
          buildingId: 'bld-bv-main',
          roomChoice: 'room',
          roomId: 'rm-bv-101',
          peopleAffected: 2.5,
        },
      },
    })
    assert.equal(fraction.status, 422)

    const large = await createComplaint(app, student, { peopleAffected: 1_000_000 })
    assert.equal(large.peopleAffected, 1_000_000)
  })
})

/* ------------------------------------------------------------------ */
/* Part 1 — the five-item shell and administrator-only endpoints      */
/* ------------------------------------------------------------------ */

describe('E1 Part 1 admin endpoints and shell', () => {
  let app: RunningApp
  let admin: TestSession
  let estates: TestSession

  before(async () => {
    app = await startApp()
    admin = await signIn(app, 'sample-admin', 'admin')
    estates = await signIn(app, 'sample-estates', 'estates')
  })
  after(async () => {
    await app.close()
  })

  it('refuses estates on administrator endpoints and allows an administrator', async () => {
    const newAccount = {
      username: 'e1-staff-account',
      displayName: 'E1 Staff Account',
      password: 'e1-staff-account-pass',
      role: 'estates',
    }

    const estatesCreate = await call(app, '/members', { method: 'POST', session: estates, body: newAccount })
    console.log('estates create member:', estatesCreate.status)
    assert.equal(estatesCreate.status, 403)

    const estatesRole = await call(app, '/members/usr-bv-maint', {
      method: 'PATCH',
      session: estates,
      body: { role: 'maintenance' },
    })
    assert.equal(estatesRole.status, 403)

    const estatesImport = await call(app, '/import/preview', {
      method: 'POST',
      session: estates,
      body: { fileName: 'e1.csv', mode: 'append', sheets: [{ entity: 'rooms', rows: [{}] }] },
    })
    console.log('estates import preview:', estatesImport.status)
    assert.equal(estatesImport.status, 403)

    const created = await call<{ members?: Array<{ id: string; displayName: string; role: string }> }>(
      app,
      '/members',
      { method: 'POST', session: admin, body: newAccount },
    )
    assert.equal(created.status, 201, JSON.stringify(created.payload))
    const member = created.payload.members?.find((item) => item.displayName === newAccount.displayName)
    assert.ok(member, 'the administrator sees the new account')

    const changed = await call(app, `/members/${member.id}`, {
      method: 'PATCH',
      session: admin,
      body: { role: 'maintenance' },
    })
    assert.equal(changed.status, 200)

    const adminImport = await call(app, '/import/preview', {
      method: 'POST',
      session: admin,
      body: { fileName: 'e1.csv', mode: 'append', sheets: [{ entity: 'rooms', rows: [{}] }] },
    })
    assert.notEqual(adminImport.status, 403, 'the administrator passes the import capability check')
  })

  it('keeps exactly five primary staff items and administration off the sidebar', async () => {
    const expected = [
      '/dashboard',
      '/dashboard/needs-gaps',
      '/dashboard/resources',
      '/dashboard/issues-maintenance',
      '/dashboard/plan-report',
    ]
    for (const role of ['admin', 'estates'] as const) {
      assert.deepEqual(
        dashboardNavFor(role).map((item) => item.path),
        expected,
        `${role} must have exactly the five operational items`,
      )
      assert.equal(dashboardNavFor(role).length, 5)
    }

    for (const role of ['admin', 'estates'] as const) {
      const secondary = dashboardSecondaryNavFor(role).map((item) => item.path)
      assert.deepEqual(secondary, ['/dashboard/inventory', '/dashboard/help'])
      assert.ok(!dashboardNavFor(role).some((item) => item.path.includes('administration')))
      assert.ok(!secondary.includes('/dashboard/data-centre'))
      assert.ok(!secondary.includes('/dashboard/administration'))
      assert.ok(!dashboardNavFor(role).some((item) => item.path === '/dashboard/data-centre'))
    }

    assert.deepEqual(
      dashboardMoreNavFor('admin').map((item) => item.path),
      ['/dashboard/data-centre', '/dashboard/help', '/dashboard/administration'],
    )
    assert.ok(!dashboardMoreNavFor('estates').some((item) => item.path.includes('administration')))
    assert.ok(!dashboardMoreNavFor('estates').some((item) => item.path.includes('data-centre')))

    const sidebar = await readFile(
      new URL('../src/components/dashboard/Sidebar.tsx', import.meta.url),
      'utf8',
    )
    assert.match(sidebar, /'\/dashboard\/inventory': 'Records'/)
    assert.match(sidebar, /'\/dashboard\/help': 'Profile and Help'/)

    const routes = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
    assert.match(
      routes,
      /path="data-centre"[\s\S]{0,120}<RequireRole allowed=\{\['admin'\]\}>/,
      'the Data Centre route is administrator-only',
    )
    assert.match(
      routes,
      /path="administration"[\s\S]{0,120}<RequireRole allowed=\{\['admin'\]\}>/,
      'the Administration route is administrator-only',
    )

    const permissions = await readFile(
      new URL('../src/domain/permissions.ts', import.meta.url),
      'utf8',
    )
    assert.match(permissions, /'import-data': \['admin'\]/)
    assert.match(permissions, /'approve-decisions': \['admin'\]/)
  })
})

/* ------------------------------------------------------------------ */
/* Part 3 — five Needs and Gaps categories from recorded data only    */
/* ------------------------------------------------------------------ */

function categoriesFor(payload: WorkspacePayload) {
  const analysis = analyseWorkspace(payload.dataset, payload.serverTime)
  return {
    analysis,
    categories: buildNeedsCategories(
      payload.dataset,
      analysis.capacity,
      analysis.utilities,
      analysis.findings,
    ),
  }
}

describe('E1 Part 3 Needs and Gaps categories', () => {
  let app: RunningApp
  let admin: TestSession
  let estates: TestSession
  let faculty: TestSession

  before(async () => {
    app = await startApp()
    admin = await signIn(app, 'sample-admin', 'admin')
    estates = await signIn(app, 'sample-estates', 'estates')
    faculty = await signIn(app, 'sample-faculty', 'faculty')
  })
  after(async () => {
    await app.close()
  })

  it('shows Not enough data for every category when no records exist', () => {
    const empty: DatasetSources = {
      buildings: [],
      rooms: [],
      timetableSlots: [],
      attendanceRecords: [],
      assets: [],
      inspections: [],
      utilityMeters: [],
      utilityReadings: [],
      tariffs: [],
      complaints: [],
      complaintUpdates: [],
      planOptions: [],
      decisions: [],
      nearbyAssets: [],
      urbanAssets: [],
      urbanIssues: [],
    }
    const analysis = analyseWorkspace(empty, '2026-11-14T00:00:00Z')
    const rows = buildNeedsCategories(empty, analysis.capacity, analysis.utilities, analysis.findings)
    assert.deepEqual(rows.map((row) => row.label), ['Rooms', 'Water', 'Lighting', 'Waste', 'Parking'])
    for (const row of rows) {
      assert.equal(row.status, 'not_enough_data', `${row.label} must not be scored without records`)
      assert.equal(row.statusLabel, 'Not enough data')
      assert.notEqual(row.status, 'adequate')
    }
  })

  it('reports Not enough data for Water, Lighting, Waste and Parking in the seed', async () => {
    const workspace = await loadWorkspace(app, admin)
    const { categories, analysis } = categoriesFor(workspace)
    const byKey = new Map(categories.map((row) => [row.key, row]))

    assert.equal(byKey.get('water')?.status, 'not_enough_data')
    assert.equal(byKey.get('lighting')?.status, 'not_enough_data')
    assert.equal(byKey.get('waste')?.status, 'not_enough_data')
    assert.equal(byKey.get('parking')?.status, 'not_enough_data')
    assert.match(String(byKey.get('lighting')?.demand), /no fault counts recorded/i)
    assert.match(String(byKey.get('water')?.demand), /no limit recorded/i)
    assert.equal(byKey.get('waste')?.demand, 'Data missing')
    assert.equal(byKey.get('parking')?.demand, 'Data missing')

    for (const key of ['water', 'lighting', 'waste', 'parking'] as const) {
      assert.notEqual(byKey.get(key)?.status, 'adequate')
    }

    const rooms = byKey.get('rooms')
    assert.ok(rooms)
    assert.equal(rooms.facts.roomCode, '1.01')
    assert.equal(rooms.facts.enrolled, 42)
    assert.equal(rooms.facts.seats, 30)
    const decidingRoom = analysis.capacity.rooms.find((room) => room.code === rooms.facts.roomCode)
    assert.equal(rooms.facts.decidingScore, decidingRoom?.score)
    assert.equal(rooms.status, decidingRoom?.status)
    assert.equal(rooms.facts.sessionsUsed, 4, 'only sessions with both attendance and seat capacity count')
    assert.equal(rooms.facts.sessionsTotal, 7)
    assert.equal(rooms.facts.present, 94)
    assert.match(rooms.demand, /Enrolled 42 vs 30 seats/)
    assert.ok(rooms.why.some((line) => /Project assumption \(not a published norm\)/.test(line)))
    assert.ok(rooms.method.some((line) => /Average present/.test(line)))
    assert.ok(rooms.method.some((line) => /4 of 7 sessions recorded/.test(line)))
  })

  it('changes the Rooms row status and counts after attendance is saved', async () => {
    const before = await loadWorkspace(app, faculty)
    const beforeRow = categoriesFor(before).categories.find((row) => row.key === 'rooms')
    assert.ok(beforeRow)
    assert.equal(beforeRow.status, 'critical')

    const slot = before.dataset.timetableSlots.find((item) => item.id === 'tlt-bv-1')
    assert.ok(slot)
    const sessionDate = istDateKey(slot.startsAt)
    assert.ok(sessionDate)

    const saved = await saveAttendance(app, faculty, {
      slotId: slot.id,
      sessionDate,
      present: 10,
      reasons: ['room_too_small'],
    })
    assert.equal(saved.status, 201, JSON.stringify(saved.payload))

    const after = await loadWorkspace(app, faculty)
    const { analysis, categories } = categoriesFor(after)
    const afterRow = categories.find((row) => row.key === 'rooms')
    assert.ok(afterRow)

    const room = analysis.capacity.rooms.find((item) => item.roomId === 'rm-bv-101')
    assert.ok(room)
    assert.equal(room.status, 'stressed', 'the saved attendance changes the room status')

    assert.equal(afterRow.status, 'stressed', 'the Rooms category follows the room status')
    assert.equal(afterRow.facts.enrolled, beforeRow.facts.enrolled, 'enrolled does not change')
    assert.equal(afterRow.facts.sessionsTotal, beforeRow.facts.sessionsTotal)
    assert.equal(afterRow.facts.sessionsUsed, beforeRow.facts.sessionsUsed)
    assert.equal(afterRow.facts.present, (beforeRow.facts.present ?? 0) - 29)
    assert.match(
      afterRow.method.join(' '),
      /4 of 7 sessions recorded/,
      'the calculation panel carries the same session coverage as the row',
    )
    assert.match(afterRow.method.join(' '), /Average present/)
  })

  it('refuses estates approval, lets estates propose and lets an administrator approve', async () => {
    const refused = await call<{ error?: string }>(app, '/decisions/dec-bv-room', {
      method: 'PATCH',
      session: estates,
      body: { data: { status: 'approved' } },
    })
    console.log('estates approve:', refused.status)
    assert.equal(refused.status, 403)
    assert.match(String(refused.payload.error), /administrator/i)

    const proposal = await call<{ record?: { id: string; status: string } }>(app, '/decisions', {
      method: 'POST',
      session: estates,
      body: {
        data: {
          optionId: 'opt-bv-room',
          title: 'E1 estate proposal for the 30-seat room',
          notes: 'Proposed from Needs and Gaps.',
        },
      },
    })
    assert.equal(proposal.status, 201, JSON.stringify(proposal.payload))
    assert.equal(proposal.payload.record?.status, 'proposed')
    const decisionId = proposal.payload.record?.id
    assert.ok(decisionId)

    const approved = await call<{ record?: { status: string; decidedAt: string | null; decidedByUserId: string | null } }>(
      app,
      `/decisions/${decisionId}`,
      { method: 'PATCH', session: admin, body: { data: { status: 'approved' } } },
    )
    assert.equal(approved.status, 200, JSON.stringify(approved.payload))
    assert.equal(approved.payload.record?.status, 'approved')
    assert.ok(approved.payload.record?.decidedAt)
    assert.equal(approved.payload.record?.decidedByUserId, admin.userId)

    const workspace = await loadWorkspace(app, estates)
    const decision = workspace.dataset.decisions.find((item) => item.id === decisionId)
    assert.ok(decision)
    assert.equal(decision.status, 'approved')
    assert.ok(decision.decidedAt)
    assert.equal(decision.ownerName ?? null, null)
  })

  it('uses rule-based facts and delegates optional explanations on Needs and Gaps', async () => {
    const source = (await Promise.all([
      '../src/pages/dashboard/NeedsGaps.tsx',
      '../src/components/dashboard/NearbyNeeds.tsx',
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')))).join('\n')
    for (const fragment of [
      'Campus',
      'Nearby area',
      'No nearby asset data yet',
      'Not enough data',
      'How is this calculated?',
      'Rule-based explanation',
      'Cost:',
      'not entered',
      'Assumption:',
      'Approve',
      'Propose',
      'Decision log',
    ]) {
      assert.ok(source.includes(fragment), `Needs and Gaps must contain "${fragment}"`)
    }
    assert.ok(source.includes('FindingExplainer'), 'the shared guarded explainer is used')
    assert.ok(source.includes('compact'), 'the existing rule-based panel remains the explanation surface')
    assert.ok(!source.includes('aiAssist'), 'Needs and Gaps does not call the AI endpoint')
    assert.match(source, /role === 'admin'/)
    assert.match(source, /role === 'estates'/)
  })
})
