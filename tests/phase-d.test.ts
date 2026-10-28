/**
 * Phase D — the maintenance role.
 *
 * These tests cover the server rules behind My jobs and Inspections: who may
 * see a job, which direction its status may move, what a completion needs, and
 * what the technician's workspace is allowed to contain.
 */
import { createServer, type Server } from 'node:http'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createMicrocityApp } from '../server/app.ts'
import { createDatabase } from '../server/db.ts'
import { slotsWithoutEnrolledNumber } from '../src/domain/analysis/capacity.ts'
import { reportStage } from '../src/domain/progress.ts'
import { istDateKey } from '../src/lib/time.ts'
import type { JobBoard, JobCard } from '../src/domain/jobs.ts'
import type { Complaint, UserRole, WorkspacePayload } from '../src/domain/types.ts'

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
  const payload = (text ? (JSON.parse(text) as unknown) : {}) as T
  return { status: response.status, payload }
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
  const body = {
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
  }
  const result = await call<{ record: Complaint; error?: string }>(app, '/records/complaints', {
    method: 'POST',
    session,
    body,
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

async function recordInspection(
  app: RunningApp,
  session: TestSession | null,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: { error?: string; fieldErrors?: Record<string, string> } }> {
  return call(app, '/inspections/record', { method: 'POST', session, body })
}

const VALID_NOTE = 'Replaced the projector power cable and tested it for a full hour.'

describe('maintenance job board', () => {
  let app: RunningApp
  let technician: TestSession
  let otherTechnician: TestSession

  before(async () => {
    app = await startApp()
    technician = await signIn(app, 'sample-maintenance', 'maintenance')
    const admin = await signIn(app, 'sample-admin', 'admin')
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

  it('lists only jobs assigned to the signed-in technician', async () => {
    const result = await jobBoard(app, technician)
    assert.equal(result.status, 200)
    assert.ok(result.payload.jobs.length > 0, 'the demo technician has assigned jobs')
    const workspace = await loadWorkspace(app, technician)
    const assignedIds = new Set(
      workspace.dataset.complaints.map((complaint) => complaint.id),
    )
    for (const job of result.payload.jobs) {
      assert.ok(assignedIds.has(job.id), `job ${job.id} is not assigned to this technician`)
    }
    assert.ok(
      !result.payload.jobs.some((job) => job.id === 'cmp-fd-valve'),
      'a job from another college must never appear',
    )
  })

  it('writes the one-line reason from the existing triage points', async () => {
    const result = await jobBoard(app, technician)
    const active = result.payload.jobs.filter((job) => job.group !== 'done')
    assert.ok(active.length > 0)
    for (const job of active) {
      assert.match(
        job.reason,
        /^(Critical|High|Medium|Low), \d+ days? open, (about \d+ (person|people) affected|number affected not recorded)$/,
        `unexpected reason line: ${job.reason}`,
      )
      assert.ok(job.priority, 'an active job carries its triage breakdown')
      const sum = (job.priority?.components ?? []).reduce((total, component) => total + component.points, 0)
      assert.equal(sum, job.priority?.score, 'the breakdown must add up to the recorded score')
    }
    const welding = result.payload.jobs.find((job) => job.id === 'cmp-bv-welding')
    console.log('reason line for cmp-bv-welding:', welding?.reason)
  })

  it('refuses students, faculty and anonymous callers', async () => {
    const student = await signIn(app, 'sample-student', 'student')
    const faculty = await signIn(app, 'sample-faculty', 'faculty')
    assert.equal((await jobBoard(app, student)).status, 403)
    assert.equal((await jobBoard(app, faculty)).status, 403)
    assert.equal((await jobBoard(app, null)).status, 401)
    const anonymousMove = await jobMove(app, null, 'cmp-bv-welding', 'start')
    assert.equal(anonymousMove.status, 401)
    const studentMove = await jobMove(app, student, 'cmp-bv-welding', 'start')
    assert.equal(studentMove.status, 403)
  })

  it('hides another technician’s job from the board and refuses to move it', async () => {
    const estates = await signIn(app, 'sample-estates', 'estates')
    const student = await signIn(app, 'sample-student', 'student')
    const complaint = await createComplaint(app, student, { severity: 'critical' })
    await assignTo(app, estates, complaint.id, technician.userId)

    const foreign = await jobBoard(app, otherTechnician)
    assert.ok(
      !foreign.payload.jobs.some((job) => job.id === complaint.id),
      'a colleague’s job must not appear on my board',
    )

    const blockedStart = await jobMove(app, otherTechnician, complaint.id, 'start')
    assert.equal(blockedStart.status, 403)
    const blockedFinish = await jobMove(app, otherTechnician, complaint.id, 'complete', {
      note: VALID_NOTE,
    })
    assert.equal(blockedFinish.status, 403)

    const stillOpen = await loadWorkspace(app, technician)
    const unchanged = stillOpen.dataset.complaints.find((item) => item.id === complaint.id)
    assert.equal(unchanged?.status, 'open', 'a refused move must not change the record')
  })

  it('refuses a job id from the other college', async () => {
    const status = await jobMove(app, technician, 'cmp-fd-valve', 'start')
    console.log(
      'test: job id from the other college is refused | job id: cmp-fd-valve | college used by the caller: clg-bv (Vidya Nagar) | HTTP status:',
      status.status,
    )
    assert.ok(status.status === 404 || status.status === 403, `expected 403/404, got ${status.status}`)
    assert.equal(status.status, 404)
    const inspection = await recordInspection(app, technician, {
      inspectionId: 'ins-fd-hoist-oct',
      result: 'no_issues',
      note: 'Checked the hoist brakes.',
    })
    console.log(
      'test: inspection id from the other college is refused | inspection id: ins-fd-hoist-oct | college used by the caller: clg-bv | HTTP status:',
      inspection.status,
    )
    assert.ok(inspection.status === 404 || inspection.status === 403)
    assert.equal(inspection.status, 404)
  })
})

describe('maintenance job status machine', () => {
  let app: RunningApp
  let technician: TestSession
  let estates: TestSession
  let student: TestSession

  before(async () => {
    app = await startApp()
    technician = await signIn(app, 'sample-maintenance', 'maintenance')
    estates = await signIn(app, 'sample-estates', 'estates')
    student = await signIn(app, 'sample-student', 'student')
  })
  after(async () => {
    await app.close()
  })

  it('runs a job from report to fixed and shows it to the student', async () => {
    const complaint = await createComplaint(app, student)
    const beforeReports = await loadWorkspace(app, student)
    const before = beforeReports.dataset.complaints.find((item) => item.id === complaint.id)
    assert.ok(before)
    assert.equal(reportStage(before), 0, 'a fresh report sits on the first step')

    await assignTo(app, estates, complaint.id, technician.userId)
    const assigned = await loadWorkspace(app, student)
    const assignedComplaint = assigned.dataset.complaints.find((item) => item.id === complaint.id)
    assert.ok(assignedComplaint)
    assert.equal(reportStage(assignedComplaint), 1, 'assigning moves the line to Assigned')

    const started = await jobMove(app, technician, complaint.id, 'start')
    assert.equal(started.status, 200)
    assert.equal(started.payload.job?.group, 'progress')
    const inProgress = await loadWorkspace(app, student)
    const progressComplaint = inProgress.dataset.complaints.find((item) => item.id === complaint.id)
    assert.ok(progressComplaint)
    assert.equal(reportStage(progressComplaint), 2, 'starting moves the line to In progress')

    const finished = await jobMove(app, technician, complaint.id, 'complete', {
      note: VALID_NOTE,
      photoName: 'after.png',
      photoDataUrl: PNG_8PX,
    })
    assert.equal(finished.status, 200)
    assert.equal(finished.payload.job?.group, 'done')
    assert.equal(finished.payload.job?.completionNote, VALID_NOTE)
    assert.equal(finished.payload.job?.hasCompletionPhoto, true)
    assert.match(String(finished.payload.job?.completedOn), /^\d{2}-\d{2}-\d{4}$/, 'done date is dd-mm-yyyy')

    const afterReports = await loadWorkspace(app, student)
    const fixed = afterReports.dataset.complaints.find((item) => item.id === complaint.id)
    assert.ok(fixed)
    assert.equal(reportStage(fixed), 3, 'the student sees Fixed')
    assert.equal(fixed.completionNote, VALID_NOTE, 'the student can read what was done')

    const history = afterReports.dataset.complaintUpdates
      .filter((update) => update.complaintId === complaint.id)
      .map((update) => `${update.kind}:${update.toStatus ?? ''}`)
    console.log('student history for the finished report:', history.join(' | '))
    assert.ok(history.some((entry) => entry.startsWith('assigned')))
    assert.ok(history.some((entry) => entry === 'status:in_progress'))
    assert.ok(history.some((entry) => entry === 'status:resolved'))
  })

  it('refuses to skip Start, to repeat a step, to go backwards and to finish without a note', async () => {
    const complaint = await createComplaint(app, student, { severity: 'medium', peopleAffected: 4 })
    await assignTo(app, estates, complaint.id, technician.userId)

    const skipped = await jobMove(app, technician, complaint.id, 'complete', { note: VALID_NOTE })
    assert.equal(skipped.status, 422, 'marking an untouched job done must be refused')
    assert.match(String(skipped.payload.error), /start the job/i)

    const shortNote = await jobMove(app, technician, complaint.id, 'complete', { note: 'done' })
    assert.equal(shortNote.status, 422)

    const missingNote = await jobMove(app, technician, complaint.id, 'complete', {})
    assert.equal(missingNote.status, 422)

    const started = await jobMove(app, technician, complaint.id, 'start')
    assert.equal(started.status, 200)
    const twice = await jobMove(app, technician, complaint.id, 'start')
    assert.equal(twice.status, 409, 'a job already in progress cannot be started again')

    const finished = await jobMove(app, technician, complaint.id, 'complete', { note: VALID_NOTE })
    assert.equal(finished.status, 200)
    const afterDone = await jobMove(app, technician, complaint.id, 'start')
    assert.equal(afterDone.status, 409, 'a finished job cannot be reopened by the technician')
    const finishAgain = await jobMove(app, technician, complaint.id, 'complete', { note: VALID_NOTE })
    assert.equal(finishAgain.status, 409, 'a finished job cannot be finished twice')

    // The generic record endpoint is held to the same machine.
    const backwards = await call(app, `/records/complaints/${complaint.id}`, {
      method: 'PATCH',
      session: technician,
      body: { data: { status: 'open' } },
    })
    assert.ok(backwards.status === 403 || backwards.status === 422, `got ${backwards.status}`)
    const skipGeneric = await createComplaint(app, student, { severity: 'low', peopleAffected: 2 })
    await assignTo(app, estates, skipGeneric.id, technician.userId)
    const genericSkip = await call(app, `/records/complaints/${skipGeneric.id}`, {
      method: 'PATCH',
      session: technician,
      body: { data: { status: 'resolved', note: VALID_NOTE } },
    })
    assert.equal(genericSkip.status, 400 === genericSkip.status ? 400 : 422, `got ${genericSkip.status}`)
    const genericNoNote = await call(app, `/records/complaints/${skipGeneric.id}`, {
      method: 'PATCH',
      session: technician,
      body: { data: { status: 'in_progress' } },
    })
    assert.equal(genericNoNote.status, 200, 'Start through the generic endpoint is still allowed')
    const genericFinishNoNote = await call(app, `/records/complaints/${skipGeneric.id}`, {
      method: 'PATCH',
      session: technician,
      body: { data: { status: 'resolved' } },
    })
    assert.equal(genericFinishNoNote.status, 422, 'finishing without a note is refused everywhere')
  })

  it('validates the after photo on the server', async () => {
    const complaint = await createComplaint(app, student, { severity: 'low', peopleAffected: 3 })
    await assignTo(app, estates, complaint.id, technician.userId)
    assert.equal((await jobMove(app, technician, complaint.id, 'start')).status, 200)

    const wrongType = await jobMove(app, technician, complaint.id, 'complete', {
      note: VALID_NOTE,
      photoName: 'after.gif',
      photoDataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    })
    assert.equal(wrongType.status, 422, 'a GIF must not be accepted')
    assert.ok(wrongType.payload.error)

    const tooLarge = await jobMove(app, technician, complaint.id, 'complete', {
      note: VALID_NOTE,
      photoName: 'huge.png',
      photoDataUrl: `data:image/png;base64,${'A'.repeat(1_600_000)}`,
    })
    assert.equal(tooLarge.status, 422, 'an oversized photo must be refused')

    const accepted = await jobMove(app, technician, complaint.id, 'complete', {
      note: VALID_NOTE,
      photoName: 'after.png',
      photoDataUrl: PNG_8PX,
    })
    assert.equal(accepted.status, 200, `valid photo should be accepted: ${JSON.stringify(accepted.payload)}`)
    assert.equal(accepted.payload.job?.completionPhotoName, 'after.png')
  })

  it('audits every move with the technician and the job id', async () => {
    const complaint = await createComplaint(app, student, { severity: 'high', peopleAffected: 6 })
    await assignTo(app, estates, complaint.id, technician.userId)
    await jobMove(app, technician, complaint.id, 'start')
    await jobMove(app, technician, complaint.id, 'complete', { note: VALID_NOTE })

    const admin = await signIn(app, 'sample-admin', 'admin')
    const workspace = await loadWorkspace(app, admin)
    const entries = workspace.audit.filter((entry) => entry.entityId === complaint.id)
    const start = entries.find((entry) => entry.action === 'job_start')
    const complete = entries.find((entry) => entry.action === 'job_complete')
    assert.ok(start, 'starting a job is audited')
    assert.ok(complete, 'finishing a job is audited')
    assert.equal(start?.actorName, 'Sample Maintenance Technician')
    assert.ok(!Number.isNaN(Date.parse(String(start?.at))))
    assert.ok(String(complete?.detail)?.includes(VALID_NOTE.slice(0, 20)))
  })
})

describe('maintenance role scope', () => {
  let app: RunningApp
  let technician: TestSession

  before(async () => {
    app = await startApp()
    technician = await signIn(app, 'sample-maintenance', 'maintenance')
  })
  after(async () => {
    await app.close()
  })

  it('sends no resources, public infrastructure or audit data to the technician', async () => {
    const workspace = await loadWorkspace(app, technician)
    assert.deepEqual(workspace.dataset.utilityMeters, [])
    assert.deepEqual(workspace.dataset.utilityReadings, [])
    assert.deepEqual(workspace.dataset.tariffs, [])
    assert.deepEqual(workspace.dataset.urbanAssets, [])
    assert.deepEqual(workspace.dataset.urbanIssues, [])
    assert.deepEqual(workspace.audit, [])
  })

  it('refuses to update a public infrastructure issue', async () => {
    const result = await call(app, '/records/urbanIssues/ui-2', {
      method: 'PATCH',
      session: technician,
      body: { data: { status: 'resolved' } },
    })
    assert.ok(result.status === 403 || result.status === 422, `got ${result.status}`)
    assert.equal(result.status, 403)
  })

  it('refuses to write meter readings', async () => {
    const workspace = await loadWorkspace(app, await signIn(app, 'sample-admin', 'admin'))
    const reading = workspace.dataset.utilityReadings[0]
    const result = await call(app, `/records/utilityReadings/${reading.id}`, {
      method: 'PATCH',
      session: technician,
      body: { data: { value: 1 } },
    })
    assert.equal(result.status, 403)
  })

  it('keeps the technician navigation to three items', async () => {
    const { dashboardNavFor } = await import('../src/components/dashboard/nav.ts')
    assert.deepEqual(
      dashboardNavFor('maintenance').map((item) => item.label),
      ['My jobs', 'Inspections', 'Help'],
    )
    assert.deepEqual(
      dashboardNavFor('maintenance').map((item) => item.path),
      ['/dashboard', '/dashboard/inspections', '/dashboard/help'],
    )
  })
})

describe('maintenance inspections', () => {
  let app: RunningApp
  let technician: TestSession
  let otherTechnician: TestSession

  before(async () => {
    app = await startApp()
    technician = await signIn(app, 'sample-maintenance', 'maintenance')
    const admin = await signIn(app, 'sample-admin', 'admin')
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

  it('refuses an inspection assigned to someone else', async () => {
    const result = await recordInspection(app, otherTechnician, {
      inspectionId: 'ins-bv-boiler-oct',
      result: 'no_issues',
      note: 'Looked at the boiler.',
    })
    assert.equal(result.status, 403)
  })

  it('checks the result and the note, then saves the date and clears the due list', async () => {
    const before = await jobBoard(app, technician)
    const dueBefore = before.payload.inspections.filter(
      (inspection) => inspection.due === 'overdue' || inspection.due === 'due-soon',
    )
    assert.ok(dueBefore.some((inspection) => inspection.id === 'ins-bv-boiler-oct'))

    const badResult = await recordInspection(app, technician, {
      inspectionId: 'ins-bv-boiler-oct',
      result: 'maybe',
      note: 'Pressure held steady for ten minutes.',
    })
    assert.equal(badResult.status, 422)

    const shortNote = await recordInspection(app, technician, {
      inspectionId: 'ins-bv-boiler-oct',
      result: 'no_issues',
      note: 'ok',
    })
    assert.equal(shortNote.status, 422)

    const saved = await recordInspection(app, technician, {
      inspectionId: 'ins-bv-boiler-oct',
      result: 'no_issues',
      note: 'Pressure held steady for ten minutes; no leaks found.',
    })
    assert.equal(saved.status, 200, JSON.stringify(saved.payload))

    const after = await jobBoard(app, technician)
    const dueAfter = after.payload.inspections.filter(
      (inspection) => inspection.due === 'overdue' || inspection.due === 'due-soon',
    )
    assert.ok(
      !dueAfter.some((inspection) => inspection.id === 'ins-bv-boiler-oct'),
      'a recorded inspection leaves the due list',
    )
    const recorded = after.payload.inspections.find((inspection) => inspection.id === 'ins-bv-boiler-oct')
    assert.equal(recorded?.due, 'completed')
    assert.equal(recorded?.result, 'no_issues')
    assert.match(String(recorded?.completedOn), /^\d{2}-\d{2}-\d{4}$/)
    assert.equal(after.payload.inspectionsDue, dueAfter.length + after.payload.inspections.filter((i) => i.due === 'later').length)

    const twice = await recordInspection(app, technician, {
      inspectionId: 'ins-bv-boiler-oct',
      result: 'issues_found',
      note: 'Tried to record it a second time.',
    })
    assert.equal(twice.status, 409)

    const admin = await signIn(app, 'sample-admin', 'admin')
    const workspace = await loadWorkspace(app, admin)
    const audit = workspace.audit.find(
      (entry) => entry.entity === 'inspections' && entry.entityId === 'ins-bv-boiler-oct',
    )
    assert.ok(audit, 'recording an inspection is audited')
    assert.equal(audit?.actorName, 'Sample Maintenance Technician')
  })
})

describe('phase D carry-over from attendance', () => {
  let app: RunningApp
  let faculty: TestSession
  let admin: TestSession

  before(async () => {
    app = await startApp()
    faculty = await signIn(app, 'sample-faculty', 'faculty')
    admin = await signIn(app, 'sample-admin', 'admin')
  })
  after(async () => {
    await app.close()
  })

  async function saveAttendance(body: Record<string, unknown>) {
    return call(app, '/attendance', { method: 'POST', session: faculty, body })
  }

  it('refuses a session whose start time has not arrived yet', async () => {
    const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000)
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000)
    const created = await call<{ record: { id: string } }>(app, '/records/timetableSlots', {
      method: 'POST',
      session: admin,
      body: {
        data: {
          roomId: 'rm-bv-101',
          activity: 'Later today seminar (invented session)',
          moduleCode: 'SEM999',
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          expectedAttendance: 20,
          attendance: null,
        },
      },
    })
    assert.equal(created.status, 201, JSON.stringify(created.payload))
    const slotId = created.payload.record.id
    const sessionDate = istDateKey(startsAt.toISOString())
    const result = await saveAttendance({ slotId, sessionDate, present: 5, reasons: [] })
    console.log(
      'test: attendance refused before the session starts | slot:',
      slotId,
      '| starts at:',
      startsAt.toISOString(),
      '| HTTP status:',
      result.status,
    )
    assert.equal(result.status, 422)
    assert.match(String((result.payload as { error?: string }).error), /not started/i)
  })

  it('still accepts a session that started earlier today', async () => {
    const started = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const endsAt = new Date(started.getTime() + 60 * 60 * 1000)
    const created = await call<{ record: { id: string } }>(app, '/records/timetableSlots', {
      method: 'POST',
      session: admin,
      body: {
        data: {
          roomId: 'rm-bv-201',
          activity: 'Earlier today clinic (invented session)',
          moduleCode: 'CLIN999',
          startsAt: started.toISOString(),
          endsAt: endsAt.toISOString(),
          expectedAttendance: 10,
          attendance: null,
        },
      },
    })
    assert.equal(created.status, 201)
    const result = await saveAttendance({
      slotId: created.payload.record.id,
      sessionDate: istDateKey(started.toISOString()),
      present: 8,
      reasons: [],
    })
    assert.equal(result.status, 201, JSON.stringify(result.payload))
  })

  it('counts slots that have no enrolled number, and the Overview reports them', async () => {
    assert.equal(
      slotsWithoutEnrolledNumber([
        { expectedAttendance: null },
        { expectedAttendance: 0 },
        { expectedAttendance: 24 },
        { expectedAttendance: null },
      ] as never),
      2,
      'only a missing enrolled number counts; a recorded zero does not',
    )

    const before = await loadWorkspace(app, faculty)
    const beforeCount = slotsWithoutEnrolledNumber(before.dataset.timetableSlots)
    const startsAt = new Date(Date.now() - 4 * 60 * 60 * 1000)
    const created = await call<{ record: { id: string } }>(app, '/records/timetableSlots', {
      method: 'POST',
      session: admin,
      body: {
        data: {
          roomId: 'rm-bv-l1',
          activity: 'Reading group (invented session)',
          moduleCode: 'RED999',
          startsAt: startsAt.toISOString(),
          endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000).toISOString(),
          expectedAttendance: null,
          attendance: null,
        },
      },
    })
    assert.equal(created.status, 201)
    const after = await loadWorkspace(app, faculty)
    assert.equal(slotsWithoutEnrolledNumber(after.dataset.timetableSlots), beforeCount + 1)

    // Such a session stays unloggable: the server refuses it.
    const refused = await saveAttendance({
      slotId: created.payload.record.id,
      sessionDate: istDateKey(startsAt.toISOString()),
      present: 5,
      reasons: [],
    })
    assert.equal(refused.status, 422)

    const { readFile } = await import('node:fs/promises')
    const overview = await readFile(new URL('../src/pages/dashboard/Overview.tsx', import.meta.url), 'utf8')
    assert.match(overview, /Slots with no enrolled number/, 'the Overview data-quality row must name this gap')
    assert.match(overview, /slots have no enrolled/, 'the Overview summary line must count the gap')
  })
})
