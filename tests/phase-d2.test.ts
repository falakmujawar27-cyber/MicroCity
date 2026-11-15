/**
 * Phase D2 — fixes on top of the maintenance role.
 *
 * These tests cover honest closed-without-repair reporting, college-wide
 * priority and repeat consistency, authenticated photo delivery, unassigned
 * inspections, reassignment, the history trail and the generic-PATCH bypass
 * attempts. Every database change is additive JSON; no field is renamed.
 */
import { createServer, type Server } from 'node:http'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createMicrocityApp } from '../server/app.ts'
import { createDatabase } from '../server/db.ts'
import { analyseWorkspace } from '../src/domain/analysis/index.ts'
import { CLOSED_WITHOUT_REPAIR, REPORT_STEPS, reportStage, reportSteps } from '../src/domain/progress.ts'
import type { JobBoard, JobCard } from '../src/domain/jobs.ts'
import type { Complaint, Inspection, UserRole, WorkspacePayload } from '../src/domain/types.ts'

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
const VALID_NOTE = 'Replaced the projector power cable and tested it for a full hour.'

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

async function assignTo(
  app: RunningApp,
  estates: TestSession,
  complaintId: string,
  userId: string,
): Promise<void> {
  const result = await call<{ error?: string }>(app, `/records/complaints/${complaintId}`, {
    method: 'PATCH',
    session: estates,
    body: { data: { assignedToUserId: userId } },
  })
  assert.equal(result.status, 200, `assignment should succeed: ${JSON.stringify(result.payload)}`)
}

async function jobBoard(app: RunningApp, session: TestSession | null): Promise<{ status: number; payload: JobBoard }> {
  return call<JobBoard>(app, '/jobs', { session })
}

async function jobMove(
  app: RunningApp,
  session: TestSession | null,
  jobId: string,
  move: 'start' | 'complete',
  body: Record<string, unknown> = {},
): Promise<{ status: number; payload: { job?: JobCard; error?: string } }> {
  return call(app, `/jobs/${jobId}/${move}`, { method: 'POST', session, body })
}

async function complaintPatch(
  app: RunningApp,
  session: TestSession,
  id: string,
  data: Record<string, unknown>,
): Promise<{ status: number; payload: { error?: string; fieldErrors?: Record<string, string>; record?: Complaint } }> {
  return call(app, `/records/complaints/${id}`, { method: 'PATCH', session, body: { data } })
}

async function photoResponse(
  app: RunningApp,
  session: TestSession | null,
  id: string,
  kind: 'report' | 'completion',
  collegeId = 'clg-bv',
): Promise<{ status: number; type: string | null; bytes: Buffer }> {
  const response = await fetch(
    `${app.url}/api/complaints/${encodeURIComponent(id)}/photo?kind=${kind}&collegeId=${encodeURIComponent(collegeId)}`,
    { headers: session ? { Cookie: session.cookie } : {} },
  )
  const buffer = Buffer.from(await response.arrayBuffer())
  return { status: response.status, type: response.headers.get('content-type'), bytes: buffer }
}

describe('D2 closed without repair', () => {
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

  it('refuses to close a report without a written reason', async () => {
    const complaint = await createComplaint(app, student, { severity: 'low', peopleAffected: 3 })
    await assignTo(app, estates, complaint.id, technician.userId)

    const noNote = await complaintPatch(app, estates, complaint.id, { status: 'closed' })
    console.log('close without a reason | HTTP status:', noNote.status, '| error:', noNote.payload.error)
    assert.equal(noNote.status, 422)
    assert.match(String(noNote.payload.error), /why this report is being closed/i)

    const shortNote = await complaintPatch(app, estates, complaint.id, { status: 'closed', note: 'Not fixed' })
    assert.equal(shortNote.status, 422, 'a reason shorter than 10 characters is refused')

    const closed = await complaintPatch(app, estates, complaint.id, {
      status: 'closed',
      note: 'Replacement part is no longer available, so the unit will be removed instead.',
    })
    assert.equal(closed.status, 200, JSON.stringify(closed.payload))

    const workspace = await loadWorkspace(app, student)
    const record = workspace.dataset.complaints.find((item) => item.id === complaint.id)
    assert.ok(record)
    assert.equal(record.status, 'closed')
    assert.equal(record.resolvedAt, null, 'a close without repair must not claim a resolution time')
    assert.match(String(record.closedReason), /replacement part/i)
    assert.equal(reportStage(record), 3, 'the line reaches its last step')
    assert.deepEqual(reportSteps(record), [...REPORT_STEPS.slice(0, 3), CLOSED_WITHOUT_REPAIR])
    assert.notEqual(reportSteps(record)[3], 'Fixed', 'the student must not read Fixed')
    assert.equal(CLOSED_WITHOUT_REPAIR, 'Closed without repair')

    const board = await jobBoard(app, technician)
    const job = board.payload.jobs.find((item) => item.id === complaint.id)
    assert.ok(job, 'the closed job stays on the technician board')
    assert.equal(job.group, 'done')
    assert.equal(job.status, 'closed')
    assert.match(String(job.closedReason), /replacement part/i)
    assert.ok(job.completedOn, 'the closed date is shown instead of a done date')
    assert.equal(job.completionNote, null)
  })

  it('keeps Fixed for a report the technician repaired', async () => {
    const complaint = await createComplaint(app, student, { severity: 'medium', peopleAffected: 5 })
    await assignTo(app, estates, complaint.id, technician.userId)
    assert.equal((await jobMove(app, technician, complaint.id, 'start')).status, 200)
    assert.equal(
      (await jobMove(app, technician, complaint.id, 'complete', { note: VALID_NOTE })).status,
      200,
    )

    const workspace = await loadWorkspace(app, student)
    const record = workspace.dataset.complaints.find((item) => item.id === complaint.id)
    assert.ok(record)
    assert.equal(record.status, 'resolved')
    assert.equal(reportSteps(record)[3], 'Fixed')
    assert.equal(record.closedReason ?? null, null)
    assert.equal(record.completionNote, VALID_NOTE)
  })

  it('keeps Fixed when a repaired report is filed closed without a new reason', async () => {
    const complaint = await createComplaint(app, student, { severity: 'medium', peopleAffected: 4 })
    await assignTo(app, estates, complaint.id, technician.userId)
    await jobMove(app, technician, complaint.id, 'start')
    await jobMove(app, technician, complaint.id, 'complete', { note: VALID_NOTE })

    const closed = await complaintPatch(app, estates, complaint.id, { status: 'closed' })
    assert.equal(closed.status, 200, JSON.stringify(closed.payload))
    const record = (await loadWorkspace(app, student)).dataset.complaints.find((item) => item.id === complaint.id)
    assert.equal(record?.status, 'closed')
    assert.ok(record?.resolvedAt, 'the repair time is retained when a fixed job is filed')
    assert.equal(record?.closedReason ?? null, null)
    assert.equal(reportSteps(record!)[3], 'Fixed', 'the student still sees Fixed')
    assert.equal(record?.completionNote, VALID_NOTE)
  })

  it('clears the closed reason when estates reopens the report', async () => {
    const complaint = await createComplaint(app, student, { severity: 'low', peopleAffected: 2 })
    const closed = await complaintPatch(app, estates, complaint.id, {
      status: 'closed',
      note: 'Reported in error; the room was double-booked.',
    })
    assert.equal(closed.status, 200)
    const reopened = await complaintPatch(app, estates, complaint.id, { status: 'open' })
    assert.equal(reopened.status, 200, JSON.stringify(reopened.payload))
    assert.equal(reopened.payload.record?.closedReason ?? null, null)
    assert.equal(reopened.payload.record?.closedAt ?? null, null)
  })
})

describe('D2 priority and repeat consistency', () => {
  let app: RunningApp
  let student: TestSession
  let estates: TestSession
  let technician: TestSession
  let admin: TestSession

  before(async () => {
    app = await startApp()
    student = await signIn(app, 'sample-student', 'student')
    estates = await signIn(app, 'sample-estates', 'estates')
    technician = await signIn(app, 'sample-maintenance', 'maintenance')
    admin = await signIn(app, 'sample-admin', 'admin')
  })
  after(async () => {
    await app.close()
  })

  it('gives the technician the same points and repeat count as the staff view', async () => {
    // Same room and category as the seeded cmp-bv-projector, so the repeat
    // count is driven by a report the technician cannot see.
    const complaint = await createComplaint(app, student, {
      category: 'IT / network',
      severity: 'high',
      roomId: 'rm-bv-101',
      peopleAffected: 40,
    })
    await assignTo(app, estates, complaint.id, technician.userId)

    const board = await jobBoard(app, technician)
    const job = board.payload.jobs.find((item) => item.id === complaint.id)
    assert.ok(job?.priority, 'the assigned job carries its priority points')

    const staffWorkspace = await loadWorkspace(app, admin)
    const staffAnalysis = analyseWorkspace(staffWorkspace.dataset, staffWorkspace.serverTime)
    const staffRanked = staffAnalysis.maintenance.ranked.find((item) => item.complaintId === complaint.id)
    assert.ok(staffRanked, 'the staff view ranks the same job')

    const jobRepeat = job.priority?.components.find((component) => component.key === 'repeat')
    const staffRepeat = staffRanked.components.find((component) => component.key === 'repeat')
    console.log(
      'priority consistency | technician:',
      `${job.priority?.score} points, ${job.priority?.bandLabel}, repeat ${jobRepeat?.points}`,
      '| staff:',
      `${staffRanked.score} points, ${staffRanked.bandLabel}, repeat ${staffRepeat?.points}`,
      '| repeat detail:',
      jobRepeat?.detail,
    )
    assert.equal(job.priority?.score, staffRanked.score, 'priority points must match')
    assert.equal(job.priority?.bandLabel, staffRanked.bandLabel, 'the band must match')
    assert.equal(jobRepeat?.points, staffRepeat?.points, 'repeat points must match')
    assert.equal(jobRepeat?.detail, staffRepeat?.detail, 'repeat count text must match')
    assert.ok((jobRepeat?.points ?? 0) > 0, 'the seeded report in the same room creates a repeat')
  })

  it('keeps other people’s job details out of the technician response', async () => {
    const board = await jobBoard(app, technician)
    const text = JSON.stringify(board.payload)
    assert.ok(!text.includes('cmp-bv-projector'), 'another report id must not appear')
    assert.ok(!text.includes('Projector mount is loose'), 'another report description must not appear')
    assert.ok(
      !board.payload.jobs.some((job) => job.id === 'cmp-bv-projector'),
      'unassigned reports are not jobs',
    )
    const workspace = await loadWorkspace(app, technician)
    assert.ok(
      !workspace.dataset.complaints.some((complaint) => complaint.id === 'cmp-bv-projector'),
      'the technician workspace only holds assigned reports',
    )
  })
})

describe('D2 complaint photos', () => {
  let app: RunningApp
  let student: TestSession
  let otherStudent: TestSession
  let estates: TestSession
  let technician: TestSession

  before(async () => {
    app = await startApp()
    student = await signIn(app, 'sample-student', 'student')
    estates = await signIn(app, 'sample-estates', 'estates')
    technician = await signIn(app, 'sample-maintenance', 'maintenance')
    const registered = await fetch(`${app.url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'student-two',
        displayName: 'Second Student',
        password: 'student-two-pass',
        role: 'student',
        collegeCode: 'VIDYA-NAGAR',
      }),
    })
    const registeredPayload = (await registered.json()) as { session?: { user: { id: string } } }
    assert.equal(registered.status, 201, JSON.stringify(registeredPayload))
    const cookie = registered.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)
    otherStudent = { cookie, userId: registeredPayload.session?.user.id ?? '', username: 'student-two' }
  })
  after(async () => {
    await app.close()
  })

  it('serves the after photo only to the reporter, the staff and the assigned technician', async () => {
    const complaint = await createComplaint(app, student, { severity: 'medium', peopleAffected: 7 })
    await assignTo(app, estates, complaint.id, technician.userId)

    const beforeBoard = await fetch(`${app.url}/api/jobs`, {
      headers: { Cookie: technician.cookie, 'X-College-Id': 'clg-bv' },
    })
    const beforeText = await beforeBoard.text()

    await jobMove(app, technician, complaint.id, 'start')
    const finished = await jobMove(app, technician, complaint.id, 'complete', {
      note: VALID_NOTE,
      photoName: 'after.png',
      photoDataUrl: PNG_8PX,
    })
    assert.equal(finished.status, 200, JSON.stringify(finished.payload))
    assert.equal(finished.payload.job?.hasCompletionPhoto, true)

    const reporter = await photoResponse(app, student, complaint.id, 'completion')
    console.log('photo access | reporter:', reporter.status, reporter.type, `${reporter.bytes.length} bytes`)
    assert.equal(reporter.status, 200)
    assert.equal(reporter.type, 'image/png')
    assert.equal(reporter.bytes.length, PNG_8PX_BYTES)

    assert.equal((await photoResponse(app, estates, complaint.id, 'completion')).status, 200, 'staff may view')
    assert.equal((await photoResponse(app, technician, complaint.id, 'completion')).status, 200, 'assigned technician may view')

    const outsider = await photoResponse(app, otherStudent, complaint.id, 'completion')
    console.log('photo access | other student in the same college:', outsider.status)
    assert.equal(outsider.status, 403)

    const otherCollege = await photoResponse(app, technician, 'cmp-fd-valve', 'completion', 'clg-bv')
    console.log('photo access | report id from the other college:', otherCollege.status)
    assert.equal(otherCollege.status, 404)

    const anonymous = await fetch(`${app.url}/api/complaints/${complaint.id}/photo?kind=completion&collegeId=clg-bv`)
    assert.equal(anonymous.status, 401)

    const noReportPhoto = await photoResponse(app, student, complaint.id, 'report')
    assert.equal(noReportPhoto.status, 404, 'no report photo was uploaded')

    const afterBoard = await fetch(`${app.url}/api/jobs`, {
      headers: { Cookie: technician.cookie, 'X-College-Id': 'clg-bv' },
    })
    const afterText = await afterBoard.text()
    console.log(
      'My jobs response size | before the after photo:',
      `${beforeText.length} bytes`,
      '| with the after photo stored:',
      `${afterText.length} bytes`,
    )
    assert.ok(!beforeText.includes('data:image'), 'list response never carries photo bytes')
    assert.ok(!afterText.includes('data:image'), 'list response never carries photo bytes')
    assert.ok(afterText.length - beforeText.length < 4096, 'a stored photo must not grow the list response')

    const workspace = await loadWorkspace(app, student)
    const record = workspace.dataset.complaints.find((item) => item.id === complaint.id)
    assert.ok(record)
    assert.equal(record.hasCompletionPhoto, true)
    assert.equal(record.completionPhotoDataUrl ?? null, null)
    assert.equal(record.photoDataUrl ?? null, null)
    assert.ok(!JSON.stringify(workspace).includes('data:image'), 'workspace lists never carry photo bytes')
  })
})

describe('D2 unassigned inspections', () => {
  let app: RunningApp
  let technician: TestSession
  let otherTechnician: TestSession
  let admin: TestSession

  before(async () => {
    app = await startApp()
    technician = await signIn(app, 'sample-maintenance', 'maintenance')
    admin = await signIn(app, 'sample-admin', 'admin')
    const created = await call(app, '/members', {
      method: 'POST',
      session: admin,
      body: {
        username: 'tech-second',
        displayName: 'Second Technician',
        password: 'tech-second-pass',
        role: 'maintenance',
      },
    })
    assert.equal(created.status, 201, JSON.stringify(created.payload))
    otherTechnician = await signIn(app, 'tech-second', 'maintenance')
  })
  after(async () => {
    await app.close()
  })

  async function createUnassignedInspection(): Promise<Inspection> {
    const result = await call<{ record: Inspection; error?: string }>(app, '/records/inspections', {
      method: 'POST',
      session: admin,
      body: {
        data: {
          assetId: 'ast-bv-lift',
          scheduledFor: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          status: 'scheduled',
          inspectorUserId: null,
          findings: null,
        },
      },
    })
    assert.equal(result.status, 201, JSON.stringify(result.payload))
    return result.payload.record
  }

  it('shows an unassigned inspection to the same college and hides another college’s', async () => {
    const inspection = await createUnassignedInspection()
    const board = await jobBoard(app, technician)
    assert.equal(board.status, 200)
    const card = board.payload.inspections.find((item) => item.id === inspection.id)
    assert.ok(card, 'an unassigned inspection belongs to the whole maintenance team')
    assert.equal(card.inspectorName, null, 'the screens label a null inspector Unassigned')
    assert.ok(
      !board.payload.inspections.some((item) => item.id === 'ins-fd-hoist-oct'),
      'another college’s unassigned inspection must never appear',
    )

    const workspace = await loadWorkspace(app, technician)
    assert.ok(
      workspace.dataset.inspections.some((item) => item.id === inspection.id),
      'the technician workspace includes it too',
    )
    assert.ok(
      !workspace.dataset.inspections.some((item) => item.id === 'ins-fd-hoist-oct'),
      'the other college inspection stays hidden',
    )
  })

  it('recording an unassigned inspection assigns it to the person who recorded it', async () => {
    const inspection = await createUnassignedInspection()
    const recorded = await call(app, '/inspections/record', {
      method: 'POST',
      session: technician,
      body: {
        inspectionId: inspection.id,
        result: 'issues_found',
        note: 'Lift door sensor is slow to release; logged for repair.',
      },
    })
    assert.equal(recorded.status, 200, JSON.stringify(recorded.payload))

    const board = await jobBoard(app, technician)
    const card = board.payload.inspections.find((item) => item.id === inspection.id)
    assert.equal(card?.status, 'completed')
    assert.equal(card?.inspectorName, 'Sample Maintenance Technician')

    const colleagueWorkspace = await loadWorkspace(app, otherTechnician)
    assert.ok(
      !colleagueWorkspace.dataset.inspections.some((item) => item.id === inspection.id),
      'a recorded inspection leaves the colleague’s list',
    )
  })
})

describe('D2 reassignment', () => {
  let app: RunningApp
  let student: TestSession
  let estates: TestSession
  let technician: TestSession
  let otherTechnician: TestSession
  let admin: TestSession

  before(async () => {
    app = await startApp()
    student = await signIn(app, 'sample-student', 'student')
    estates = await signIn(app, 'sample-estates', 'estates')
    technician = await signIn(app, 'sample-maintenance', 'maintenance')
    admin = await signIn(app, 'sample-admin', 'admin')
    await call(app, '/members', {
      method: 'POST',
      session: admin,
      body: {
        username: 'tech-second',
        displayName: 'Second Technician',
        password: 'tech-second-pass',
        role: 'maintenance',
      },
    })
    otherTechnician = await signIn(app, 'tech-second', 'maintenance')
  })
  after(async () => {
    await app.close()
  })

  it('moves the job off the first board and refuses Start and Mark done there', async () => {
    const complaint = await createComplaint(app, student, { severity: 'high', peopleAffected: 9 })
    await assignTo(app, estates, complaint.id, technician.userId)
    assert.ok(
      (await jobBoard(app, technician)).payload.jobs.some((job) => job.id === complaint.id),
      'the first technician sees the job',
    )

    await assignTo(app, estates, complaint.id, otherTechnician.userId)

    assert.ok(
      !(await jobBoard(app, technician)).payload.jobs.some((job) => job.id === complaint.id),
      'the job disappears from the first technician board',
    )
    const start = await jobMove(app, technician, complaint.id, 'start')
    const complete = await jobMove(app, technician, complaint.id, 'complete', { note: VALID_NOTE })
    console.log('after reassignment | first technician start:', start.status, '| complete:', complete.status)
    assert.equal(start.status, 403)
    assert.equal(complete.status, 403)

    const newBoard = await jobBoard(app, otherTechnician)
    assert.ok(newBoard.payload.jobs.some((job) => job.id === complaint.id))
    assert.equal((await jobMove(app, otherTechnician, complaint.id, 'start')).status, 200)
  })
})

describe('D2 history, bypass and transitions', () => {
  let app: RunningApp
  let student: TestSession
  let faculty: TestSession
  let estates: TestSession
  let technician: TestSession
  let admin: TestSession

  before(async () => {
    app = await startApp()
    student = await signIn(app, 'sample-student', 'student')
    faculty = await signIn(app, 'sample-faculty', 'faculty')
    estates = await signIn(app, 'sample-estates', 'estates')
    technician = await signIn(app, 'sample-maintenance', 'maintenance')
    admin = await signIn(app, 'sample-admin', 'admin')
  })
  after(async () => {
    await app.close()
  })

  it('shows the assignee by name in the student history', async () => {
    const complaint = await createComplaint(app, student, { severity: 'medium', peopleAffected: 6 })
    await assignTo(app, estates, complaint.id, technician.userId)
    const workspace = await loadWorkspace(app, student)
    const rows = workspace.dataset.complaintUpdates
      .filter((update) => update.complaintId === complaint.id)
      .sort((a, b) => a.at.localeCompare(b.at))
    for (const row of rows) {
      console.log(
        'history row:',
        `${row.kind} | ${row.note} | from: ${row.fromStatus ?? '—'} | to: ${row.toStatus ?? '—'} | by ${row.actorName}`,
      )
    }
    const assigned = rows.find((row) => row.kind === 'assigned')
    assert.ok(assigned)
    assert.match(assigned.note, /^Assigned to Sample Maintenance Technician\.$/)
    assert.ok(!/undefined|null/.test(assigned.note), 'the history never shows an empty assignee')
  })

  it('refuses a generic status change from a student and a faculty member', async () => {
    const complaint = await createComplaint(app, student, { severity: 'low', peopleAffected: 3 })
    const studentAttempt = await complaintPatch(app, student, complaint.id, { status: 'in_progress' })
    const facultyAttempt = await complaintPatch(app, faculty, complaint.id, { status: 'in_progress' })
    console.log(
      'generic PATCH status by a student:',
      studentAttempt.status,
      '| by a faculty member:',
      facultyAttempt.status,
    )
    assert.equal(studentAttempt.status, 403)
    assert.equal(facultyAttempt.status, 403)
  })

  it('holds the technician to Start then Mark done on the generic endpoint', async () => {
    const complaint = await createComplaint(app, student, { severity: 'medium', peopleAffected: 5 })
    await assignTo(app, estates, complaint.id, technician.userId)

    const closedAttempt = await complaintPatch(app, technician, complaint.id, {
      status: 'closed',
      note: 'Trying to close the job directly.',
    })
    const resolvedAttempt = await complaintPatch(app, technician, complaint.id, { status: 'resolved', note: VALID_NOTE })
    const startAttempt = await complaintPatch(app, technician, complaint.id, { status: 'in_progress' })
    console.log(
      'generic PATCH status by the technician | closed:',
      closedAttempt.status,
      '| skip straight to resolved:',
      resolvedAttempt.status,
      '| in progress:',
      startAttempt.status,
    )
    assert.equal(closedAttempt.status, 422)
    assert.equal(resolvedAttempt.status, 422)
    assert.equal(startAttempt.status, 200)
  })

  it('allows the documented estates transitions and refuses closed to resolved', async () => {
    const transitions: [string, string][] = [
      ['open', 'in_progress'],
      ['open', 'resolved'],
      ['open', 'closed'],
      ['in_progress', 'resolved'],
      ['in_progress', 'open'],
      ['in_progress', 'closed'],
      ['resolved', 'in_progress'],
      ['resolved', 'closed'],
      ['closed', 'open'],
    ]
    for (const [from, to] of transitions) {
      const complaint = await createComplaint(app, student, { severity: 'low', peopleAffected: 2 })
      if (from !== 'open') {
        const first = await complaintPatch(app, estates, complaint.id, {
          status: from,
          note: 'Moving the report for a transition check.',
        })
        assert.equal(first.status, 200, `setup ${from} failed: ${JSON.stringify(first.payload)}`)
      }
      const result = await complaintPatch(app, estates, complaint.id, {
        status: to,
        note: 'Transition check with a written reason.',
      })
      console.log(`estates transition ${from} -> ${to}:`, result.status)
      assert.equal(result.status, 200)
    }

    const complaint = await createComplaint(app, student, { severity: 'low', peopleAffected: 2 })
    await complaintPatch(app, estates, complaint.id, { status: 'closed', note: 'Closing for the transition check.' })
    const forbidden = await complaintPatch(app, estates, complaint.id, {
      status: 'resolved',
      note: 'Trying to resolve a closed report.',
    })
    console.log('estates transition closed -> resolved:', forbidden.status)
    assert.equal(forbidden.status, 422)
  })

  it('still lets a faculty member report a problem and a public issue', async () => {
    const complaint = await createComplaint(app, faculty, { severity: 'medium', peopleAffected: 8 })
    assert.equal(complaint.status, 'open')
    const publicIssue = await call<{ record: { id: string } }>(app, '/records/urbanIssues', {
      method: 'POST',
      session: faculty,
      body: {
        data: {
          category: 'Broken footway light',
          severity: 'medium',
          description: 'The footway light outside the campus gate stays off after dark.',
          locationLabel: 'Campus approach road, near the main gate',
          authority: 'Municipal lighting department',
          urbanAssetId: null,
          photoName: null,
          photoDataUrl: null,
        },
      },
    })
    console.log('faculty reporting | campus report:', complaint.status, '| public issue:', publicIssue.status)
    assert.equal(publicIssue.status, 201, JSON.stringify(publicIssue.payload))
  })
})
