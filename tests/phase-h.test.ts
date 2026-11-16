import { createServer, type Server } from 'node:http'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createMicrocityApp } from '../server/app.ts'
import { createDatabase, seedDemoPlatformAdmin } from '../server/db.ts'
import { ensureTiwariWorkspace, TIWARI_COLLEGE_ADDRESS, TIWARI_COLLEGE_EMAIL, TIWARI_COLLEGE_NAME, TIWARI_WATER_LIMIT } from '../server/tiwari.ts'
import { analyseWorkspace } from '../src/domain/analysis/index.ts'
import type { WorkspacePayload } from '../src/domain/types.ts'
import { buildReportCsv, buildReportMarkdown } from '../src/lib/reports.ts'

interface RunningApp {
  url: string
  server: Server
  close: () => Promise<void>
}

async function startApp(env: NodeJS.ProcessEnv = {}): Promise<RunningApp> {
  const db = createDatabase(env.MICROCITY_DB ?? ':memory:', true)
  if (env.DEMO_MODE === 'true') seedDemoPlatformAdmin(db)
  const app = createMicrocityApp({ db, env })
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
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
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

async function login(
  app: RunningApp,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: Record<string, unknown>; cookie: string | null }> {
  const response = await fetch(`${app.url}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as Record<string, unknown>
  const header = response.headers.get('set-cookie')
  return { status: response.status, payload, cookie: header ? (header.split(';')[0] ?? null) : null }
}

async function call<T = Record<string, unknown>>(
  app: RunningApp,
  path: string,
  options: { method?: string; cookie?: string | null; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; payload: T }> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) }
  if (options.cookie) headers.Cookie = options.cookie
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${app.url}/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  return { status: response.status, payload: (await response.json()) as T }
}

async function platformLogin(app: RunningApp) {
  const result = await login(app, {
    username: 'platform-admin',
    password: 'platform-admin-demo-pass',
    role: 'platform_admin',
  })
  assert.equal(result.status, 200, JSON.stringify(result.payload))
  assert.ok(result.cookie)
  return result.cookie!
}

interface CreatedCollege {
  college: { id: string; name: string; code: string; address: string; email: string; mode: string }
  admin: { username: string; temporaryPassword: string }
}

async function createCollege(app: RunningApp, cookie: string, input: { name: string; address: string; email: string }) {
  const result = await call<CreatedCollege>(app, '/platform/colleges', { method: 'POST', cookie, body: input })
  assert.equal(result.status, 201, JSON.stringify(result.payload))
  return result.payload
}

async function adminLogin(app: RunningApp, created: CreatedCollege) {
  const result = await login(app, {
    username: created.admin.username,
    password: created.admin.temporaryPassword,
    collegeId: created.college.id,
    role: 'admin',
  })
  assert.equal(result.status, 200, JSON.stringify(result.payload))
  assert.ok(result.cookie)
  return result.cookie!
}

async function workspace(app: RunningApp, cookie: string, collegeId?: string): Promise<WorkspacePayload> {
  const result = await call<WorkspacePayload>(app, '/workspace', {
    cookie,
    headers: collegeId ? { 'X-College-Id': collegeId } : {},
  })
  assert.equal(result.status, 200, JSON.stringify(result.payload))
  return result.payload
}

describe('platform admin and college creation', () => {
  let app: RunningApp
  before(async () => {
    app = await startApp({ DEMO_MODE: 'true' })
  })
  after(async () => {
    await app.close()
  })

  it('is seeded only in demo mode and refuses anonymous callers with 401', async () => {
    const anonymous = await call(app, '/platform/colleges')
    assert.equal(anonymous.status, 401)
    const cookie = await platformLogin(app)
    const list = await call<{ colleges: Array<{ id: string; name: string }> }>(app, '/platform/colleges', { cookie })
    assert.equal(list.status, 200)
    assert.ok(list.payload.colleges.some((college) => college.name.includes('Vidya Nagar')))
  })

  it('refuses other roles and anonymous creation with 403 or 401', async () => {
    const admin = await login(app, {
      username: 'sample-admin',
      password: 'sample-admin-pass',
      collegeId: 'clg-bv',
      role: 'admin',
    })
    assert.equal(admin.status, 200)
    const refused = await call(app, '/platform/colleges', {
      method: 'POST',
      cookie: admin.cookie,
      body: { name: 'Refused College', address: 'Somewhere', email: 'office@example.edu' },
    })
    assert.equal(refused.status, 403)
    assert.equal((refused.payload as { code?: string }).code, 'platform-admin-required')

    const anonymous = await call(app, '/platform/colleges', {
      method: 'POST',
      body: { name: 'Refused College', address: 'Somewhere', email: 'office@example.edu' },
    })
    assert.equal(anonymous.status, 401)
  })

  it('keeps the platform admin outside every college workspace', async () => {
    const cookie = await platformLogin(app)
    const workspaceAttempt = await call(app, '/workspace', { cookie })
    assert.equal(workspaceAttempt.status, 400)
    assert.equal((workspaceAttempt.payload as { code?: string }).code, 'college-required')
    const forged = await call(app, '/workspace', { cookie, headers: { 'X-College-Id': 'clg-bv' } })
    assert.equal(forged.status, 403)
    assert.equal((forged.payload as { code?: string }).code, 'college-forbidden')

    const withCollege = await login(app, {
      username: 'platform-admin',
      password: 'platform-admin-demo-pass',
      role: 'platform_admin',
      collegeId: 'clg-bv',
    })
    assert.equal(withCollege.status, 403)
    assert.equal((withCollege.payload as { code?: string }).code, 'platform-admin-no-college')
  })

  it('creates a college and its first administrator for a platform admin', async () => {
    const cookie = await platformLogin(app)
    const created = await createCollege(app, cookie, {
      name: 'Phase H North College',
      address: '1 North Road, Test District',
      email: 'office@north.example.edu',
    })
    assert.equal(created.college.mode, 'pilot')
    assert.match(created.college.code, /^[A-Z]+-\d{4}$/)
    assert.match(created.admin.username, /^admin-[0-9a-f]{6}$/)
    assert.ok(created.admin.temporaryPassword.length >= 12)
    const adminCookie = await adminLogin(app, created)
    assert.ok(adminCookie.startsWith('mc_session='))
  })

  it('isolates each new college and rejects a forged college header', async () => {
    const platform = await platformLogin(app)
    const north = await createCollege(app, platform, {
      name: 'Phase H North College',
      address: '1 North Road, Test District',
      email: 'office@north.example.edu',
    })
    const south = await createCollege(app, platform, {
      name: 'Phase H South College',
      address: '2 South Road, Test District',
      email: 'office@south.example.edu',
    })
    const northAdmin = await adminLogin(app, north)
    const southAdmin = await adminLogin(app, south)

    const northImport = await call(app, '/import', {
      method: 'POST',
      cookie: northAdmin,
      body: {
        fileName: 'north.csv',
        mode: 'append',
        sheets: [{ entity: 'buildings', rows: [{ id: 'tw-test-north-block', name: 'North Imported Block', basis: 'illustrative', notes: 'Test row' }] }],
      },
    })
    assert.equal(northImport.status, 200, JSON.stringify(northImport.payload))
    assert.equal((northImport.payload as { totals?: { imported: number } }).totals?.imported, 1)

    const forged = await call(app, '/workspace', { cookie: northAdmin, headers: { 'X-College-Id': south.college.id } })
    assert.equal(forged.status, 403)
    assert.equal((forged.payload as { code?: string }).code, 'college-forbidden')

    const southWorkspace = await workspace(app, southAdmin)
    assert.equal(southWorkspace.activeCollege.id, south.college.id)
    assert.equal(southWorkspace.dataset.buildings.length, 0)

    const northWorkspace = await workspace(app, northAdmin)
    assert.equal(northWorkspace.activeCollege.id, north.college.id)
    assert.ok(northWorkspace.dataset.buildings.some((building) => building.id === 'tw-test-north-block'))
  })

  it('imports the same rows twice without duplicating records', async () => {
    const platform = await platformLogin(app)
    const college = await createCollege(app, platform, {
      name: 'Phase H Idempotent College',
      address: '3 Repeat Road, Test District',
      email: 'office@repeat.example.edu',
    })
    const admin = await adminLogin(app, college)
    const body = {
      fileName: 'repeat.csv',
      mode: 'append',
      sheets: [
        {
          entity: 'buildings',
          rows: [{ id: 'tw-test-repeat-block', name: 'Repeat Imported Block', basis: 'illustrative', notes: 'Test row' }],
        },
      ],
    }
    const first = await call<{ totals: { imported: number; skipped: number; rejected: number }; importId: string | null }>(
      app,
      '/import',
      { method: 'POST', cookie: admin, body },
    )
    assert.equal(first.status, 200, JSON.stringify(first.payload))
    assert.deepEqual(first.payload.totals, { imported: 1, skipped: 0, rejected: 0 })

    const second = await call<{ totals: { imported: number; skipped: number; rejected: number }; entities: Array<{ rows?: Array<{ status: string; id: string | null; message: string | null }> }> }>(
      app,
      '/import',
      { method: 'POST', cookie: admin, body },
    )
    assert.equal(second.status, 200, JSON.stringify(second.payload))
    assert.deepEqual(second.payload.totals, { imported: 0, skipped: 1, rejected: 0 })
    const skipped = second.payload.entities[0]?.rows?.find((row) => row.status === 'skipped')
    assert.match(skipped?.message ?? '', /already exists/)

    const loaded = await workspace(app, admin)
    assert.equal(loaded.dataset.buildings.filter((building) => building.id === 'tw-test-repeat-block').length, 1)
  })
})

describe('Tiwari pilot workspace', () => {
  let app: RunningApp
  let created: CreatedCollege
  before(async () => {
    app = await startApp({ DEMO_MODE: 'true' })
    const cookie = await platformLogin(app)
    created = await createCollege(app, cookie, {
      name: TIWARI_COLLEGE_NAME,
      address: TIWARI_COLLEGE_ADDRESS,
      email: TIWARI_COLLEGE_EMAIL,
    })
    // The pilot workbook supplies these rows in the real flow; a small subset
    // is enough to create the buildings and rooms the seeded world attaches to.
    const admin = await adminLogin(app, created)
    const first = await call(app, '/import', {
      method: 'POST',
      cookie: admin,
      body: {
        fileName: 'tiwari-subset.xlsx',
        mode: 'append',
        sheets: [
          {
            entity: 'buildings',
            rows: [
              { id: 'BLD-1', name: 'Main academic block', basis: 'illustrative', notes: 'Illustrative workbook row' },
              { id: 'BLD-2', name: 'Labs and workshop block', basis: 'illustrative', notes: 'Illustrative workbook row' },
            ],
          },
          {
            entity: 'rooms',
            rows: [
              { id: 'R-101', buildingId: 'BLD-1', code: 'R-101', name: 'Classroom 101', capacity: 60, basis: 'illustrative' },
              { id: 'R-102', buildingId: 'BLD-1', code: 'R-102', name: 'Classroom 102', capacity: 60, basis: 'illustrative' },
              { id: 'R-201', buildingId: 'BLD-1', code: 'R-201', name: 'Classroom 201', capacity: 70, basis: 'illustrative' },
              { id: 'R-202', buildingId: 'BLD-1', code: 'R-202', name: 'Classroom 202', capacity: 70, basis: 'illustrative' },
              { id: 'T-101', buildingId: 'BLD-1', code: 'T-101', name: 'Tutorial room 101', capacity: 30, basis: 'illustrative' },
              { id: 'L-001', buildingId: 'BLD-2', code: 'L-001', name: 'Computer lab 1', capacity: 30, basis: 'illustrative' },
            ],
          },
          {
            entity: 'nearbyAssets',
            rows: [
              {
                id: 'P-001',
                type: 'transport_stop',
                locationDescription: 'Bus stop near the college gate (public listing)',
                distanceMetres: 250,
                distanceBasis: 'estimated',
                basis: 'estimated',
                provenanceNote: 'Public map listing checked 15-11-2026; condition and daily users not surveyed',
              },
              {
                id: 'P-002',
                type: 'transport_stop',
                locationDescription: 'Second bus stop on the same road (public listing)',
                distanceMetres: 600,
                distanceBasis: 'estimated',
                basis: 'estimated',
                provenanceNote: 'Public map listing checked 15-11-2026; condition and daily users not surveyed',
              },
            ],
          },
        ],
      },
    })
    assert.equal(first.status, 200, JSON.stringify(first.payload))
    assert.equal((first.payload as { totals?: { rejected: number } }).totals?.rejected, 0)
    const second = await call(app, '/import', {
      method: 'POST',
      cookie: admin,
      body: {
        fileName: 'tiwari-readings-subset.xlsx',
        mode: 'append',
        sheets: [
          {
            entity: 'utilityReadings',
            rows: [
              { meterId: 'M-ELEC-MAIN', readAt: '2026-07-31', value: 18120, unit: 'kWh', basis: 'illustrative' },
              { meterId: 'M-ELEC-MAIN', readAt: '2026-08-31', value: 20140, unit: 'kWh', basis: 'illustrative' },
              { meterId: 'M-ELEC-WORK', readAt: '2026-07-31', value: 6120, unit: 'kWh', basis: 'illustrative' },
              { meterId: 'M-ELEC-WORK', readAt: '2026-08-31', value: 6790, unit: 'kWh', basis: 'illustrative' },
              { meterId: 'M-WATER-CAMPUS', readAt: '2026-07-31', value: 540, unit: 'm3', basis: 'illustrative' },
              { meterId: 'M-WATER-CAMPUS', readAt: '2026-08-31', value: 610, unit: 'm3', basis: 'illustrative' },
            ],
          },
        ],
      },
    })
    assert.equal(second.status, 200, JSON.stringify(second.payload))
    assert.equal((second.payload as { totals?: { rejected: number } }).totals?.rejected, 0)
  })
  after(async () => {
    await app.close()
  })

  it('registers the five illustrative accounts in the demo account list', async () => {
    const demo = await call<{ accounts: Array<{ username: string; collegeId: string; role: string }> }>(app, '/auth/demo')
    assert.equal(demo.status, 200)
    for (const username of ['tiwari-admin', 'tiwari-estates', 'tiwari-maintenance', 'tiwari-faculty', 'tiwari-student']) {
      const account = demo.payload.accounts.find((item) => item.username === username)
      assert.ok(account, `${username} must be offered in demo mode`)
      assert.equal(account.collegeId, created.college.id)
    }
    const student = await login(app, {
      username: 'tiwari-student',
      password: 'tiwari-student-pass',
      collegeId: created.college.id,
      role: 'student',
    })
    assert.equal(student.status, 200, JSON.stringify(student.payload))
  })

  it('serves a pilot workspace labelled illustrative rather than synthetic', async () => {
    const admin = await adminLogin(app, created)
    const loaded = await workspace(app, admin)
    assert.equal(loaded.activeCollege.mode, 'pilot')
    assert.equal(loaded.provenance.synthetic, false)
    assert.equal(loaded.provenance.name, 'tiwari-illustrative-2026-11')
    assert.match(loaded.provenance.notes ?? '', /bus stops/)
  })

  it('holds a complete illustrative world with unrecorded bus stop details', async () => {
    const admin = await adminLogin(app, created)
    const loaded = await workspace(app, admin)
    const data = loaded.dataset
    const maintenance = loaded.members.find((member) => member.displayName === 'Tiwari Maintenance Technician')
    const student = loaded.members.find((member) => member.displayName === 'Tiwari Student')
    assert.ok(maintenance && student)

    const assigned = data.complaints.filter((complaint) => complaint.assignedToUserId === maintenance.id)
    assert.equal(assigned.filter((complaint) => complaint.status === 'open').length, 2)
    assert.equal(assigned.filter((complaint) => complaint.status === 'in_progress').length, 1)
    assert.equal(assigned.filter((complaint) => complaint.status === 'resolved').length, 1)
    assert.equal(data.complaints.filter((complaint) => complaint.reporterId === student.id).length, 3)
    assert.equal(data.inspections.length, 2)
    assert.ok(data.inspections.some((inspection) => inspection.scheduledFor < new Date().toISOString().slice(0, 10)))
    assert.equal(data.planOptions.length, 1)
    assert.equal(data.planOptions[0]?.basis, 'illustrative')
    assert.equal(data.planOptions[0]?.capitalCost, null)
    assert.equal(data.decisions.filter((decision) => decision.status === 'proposed').length, 1)

    const busStops = data.nearbyAssets.filter((asset) => asset.basis === 'estimated')
    assert.equal(busStops.length, 2)
    for (const stop of busStops) {
      assert.equal(stop.condition, null)
      assert.equal(stop.dailyUsers, null)
      assert.equal(stop.usersMethod, null)
      assert.equal(stop.responsibleAuthority, null)
    }

    assert.equal(data.utilityMeters.length, 3)
    assert.equal(data.utilityReadings.length, 6)
    assert.equal(data.tariffs.length, 0)
    const waterLimit = loaded.needsLimits.find((limit) => limit.category === 'water')
    assert.equal(waterLimit?.limit, TIWARI_WATER_LIMIT)
    assert.equal(waterLimit?.source, 'Project assumption for demonstration (not a published norm)')
  })

  it('keeps each row tag in the Markdown and CSV report', async () => {
    const admin = await adminLogin(app, created)
    const loaded = await workspace(app, admin)
    const analysis = analyseWorkspace(loaded.dataset, loaded.serverTime, loaded.priorityWeights)
    const markdown = buildReportMarkdown({ workspace: loaded, analysis, preparedBy: 'Test Administrator', roleLabel: 'Administrator' })
    assert.match(markdown, /\| Count \| Value \| Basis \|/)
    assert.match(markdown, /\| Room \| Building \| Capacity .* \| Basis \|/)
    assert.match(markdown, /\| Priority \| Score \| Category .* \| Basis \|/)
    assert.match(markdown, /\| Meter \| Building \| Utility .* \| Basis \|/)
    assert.match(markdown, /- Basis: \[Illustrative\]/)
    assert.match(markdown, /\[Illustrative\]/)

    const csv = buildReportCsv({ workspace: loaded, analysis, preparedBy: 'Test Administrator', roleLabel: 'Administrator' })
    assert.match(csv, /Basis/)
    assert.match(csv, /Illustrative/)
  })
})

describe('Tiwari bootstrap idempotency', () => {
  it('creates the illustrative world once and leaves it unchanged on a second run', () => {
    const db = createDatabase(':memory:', true)
    db.createCollege({
      id: 'clg-tiwari-test',
      name: TIWARI_COLLEGE_NAME,
      code: 'TIWARI-TEST',
      address: TIWARI_COLLEGE_ADDRESS,
      email: TIWARI_COLLEGE_EMAIL,
      mode: 'pilot',
    })
    ensureTiwariWorkspace(db)
    const count = () => ({
      users: ['tiwari-admin', 'tiwari-estates', 'tiwari-maintenance', 'tiwari-faculty', 'tiwari-student'].filter((username) => db.getUserByUsername(username)).length,
      meters: db.listRecords('utilityMeters', 'clg-tiwari-test').length,
      complaints: db.listRecords('complaints', 'clg-tiwari-test').length,
      inspections: db.listRecords('inspections', 'clg-tiwari-test').length,
      options: db.listRecords('planOptions', 'clg-tiwari-test').length,
    })
    const first = count()
    ensureTiwariWorkspace(db)
    const second = count()
    assert.deepEqual(second, first)
    assert.equal(first.users, 5)
  })
})
