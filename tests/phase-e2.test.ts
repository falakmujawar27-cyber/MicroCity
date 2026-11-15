import { createServer, type Server } from 'node:http'
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createMicrocityApp } from '../server/app.ts'
import { createDatabase } from '../server/db.ts'
import { analyseWorkspace, buildNeedsCategories } from '../src/domain/analysis/index.ts'
import { buildReportCsv, buildReportMarkdown } from '../src/lib/reports.ts'
import { DEFAULT_PRIORITY_WEIGHTS } from '../src/domain/types.ts'
import type { AnalysisBundle } from '../src/domain/analysis/index.ts'
import type { UserRole, WorkspacePayload } from '../src/domain/types.ts'

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

interface AuditApiRow {
  id: string
  at: string
  actorName: string | null
  action: string
  entity: string
  entityId: string | null
  detail: string
  metadata: string | null
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

function analyse(workspace: WorkspacePayload, weights = workspace.priorityWeights): AnalysisBundle {
  return analyseWorkspace(workspace.dataset, workspace.serverTime, weights)
}

function waterRow(workspace: WorkspacePayload, analysis: AnalysisBundle) {
  const rows = buildNeedsCategories(
    workspace.dataset,
    analysis.capacity,
    analysis.utilities,
    analysis.findings,
    workspace.needsLimits,
  )
  const row = rows.find((entry) => entry.key === 'water')
  assert.ok(row, 'the Water needs row must exist')
  return row
}

describe('Phase E2 — limits, weights and administrator refusals', () => {
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

  it('starts with no Water limit and reports Not enough data rather than inventing one', async () => {
    const workspace = await loadWorkspace(app, admin)
    assert.equal(workspace.needsLimits.length, 0)
    const row = waterRow(workspace, analyse(workspace))
    assert.equal(row.status, 'not_enough_data')
    assert.equal(row.statusLabel, 'Not enough data')
    assert.match(row.demand, /no limit recorded/i)
  })

  it('refuses a limit change from Estates with 403', async () => {
    const result = await call(app, '/needs-limits/water', {
      method: 'PATCH',
      session: estates,
      body: { limit: 900, unit: 'm3', source: 'Estates guess', kind: 'project_assumption' },
    })
    assert.equal(result.status, 403)
  })

  it('refuses a limit without a named source, or without a limit, with 422', async () => {
    const noSource = await call(app, '/needs-limits/water', {
      method: 'PATCH',
      session: admin,
      body: { limit: 120, unit: 'm3', source: '   ', kind: 'project_assumption' },
    })
    assert.equal(noSource.status, 422)
    const noLimit = await call(app, '/needs-limits/water', {
      method: 'PATCH',
      session: admin,
      body: { unit: 'm3', source: 'Campus water policy 2026', kind: 'project_assumption' },
    })
    assert.equal(noLimit.status, 422)
    const unsupported = await call(app, '/needs-limits/lighting', {
      method: 'PATCH',
      session: admin,
      body: { limit: 300, unit: 'lux', source: 'Campus policy', kind: 'project_assumption' },
    })
    assert.equal(unsupported.status, 422)
  })

  it('applies a saved limit to the Water row and flips its status when the limit changes', async () => {
    const generous = await call(app, '/needs-limits/water', {
      method: 'PATCH',
      session: admin,
      body: { limit: 1000, unit: 'm3', source: 'Campus water policy 2026 (project assumption)', kind: 'project_assumption' },
    })
    assert.equal(generous.status, 200)
    let workspace = await loadWorkspace(app, admin)
    assert.equal(workspace.needsLimits[0]?.limit, 1000)
    assert.equal(waterRow(workspace, analyse(workspace)).status, 'adequate')

    const tight = await call(app, '/needs-limits/water', {
      method: 'PATCH',
      session: admin,
      body: { limit: 100, unit: 'm3', source: 'Campus water policy 2026 (project assumption)', kind: 'project_assumption' },
    })
    assert.equal(tight.status, 200)
    workspace = await loadWorkspace(app, admin)
    const row = waterRow(workspace, analyse(workspace))
    assert.equal(row.status, 'critical')
    assert.match(row.demand, /100/)
    assert.match(row.why.join(' '), /Campus water policy 2026/)
  })

  it('audits each limit change with actor, time and old/new values', async () => {
    const result = await call<{ audit: AuditApiRow[] }>(app, '/admin/audit', { session: admin })
    assert.equal(result.status, 200)
    const entries = result.payload.audit.filter((row) => row.entity === 'needsLimit' && row.entityId === 'water')
    assert.ok(entries.length >= 2, 'each saved limit leaves an audit entry')
    const latest = entries[0]
    assert.equal(latest.action, 'threshold')
    assert.match(latest.actorName ?? '', /Sample Admin/)
    assert.ok(!Number.isNaN(Date.parse(latest.at)))
    assert.ok(latest.metadata, 'old and new values are stored with the audit entry')
    const metadata = JSON.parse(latest.metadata ?? '{}') as {
      old?: { limit?: number }
      new?: { limit?: number }
    }
    assert.equal(metadata.old?.limit, 1000)
    assert.equal(metadata.new?.limit, 100)
  })

  it('refuses priority-weight changes from Estates and accepts them from an administrator', async () => {
    const before = await loadWorkspace(app, admin)
    assert.equal(before.priorityWeights.severity, DEFAULT_PRIORITY_WEIGHTS.severity)

    const refused = await call(app, '/priority-weights', {
      method: 'PATCH',
      session: estates,
      body: { severity: 10, condition: 1, usersAffected: 1, daysOpen: 1 },
    })
    assert.equal(refused.status, 403)

    const accepted = await call(app, '/priority-weights', {
      method: 'PATCH',
      session: admin,
      body: { severity: 0, condition: 0, usersAffected: 10, daysOpen: 10 },
    })
    assert.equal(accepted.status, 200)

    const after = await loadWorkspace(app, admin)
    assert.equal(after.priorityWeights.severity, 0)
    assert.equal(after.priorityWeights.usersAffected, 10)

    const defaultAnalysis = analyse(after, DEFAULT_PRIORITY_WEIGHTS)
    const weightedAnalysis = analyse(after, after.priorityWeights)
    assert.notDeepEqual(
      defaultAnalysis.maintenance.ranked.map((row) => row.complaintId),
      weightedAnalysis.maintenance.ranked.map((row) => row.complaintId),
      'changing the weights changes the maintenance priority order',
    )
  })

  it('audits weight changes with old and new weights', async () => {
    const result = await call<{ audit: AuditApiRow[] }>(app, '/admin/audit', { session: admin })
    const entry = result.payload.audit.find((row) => row.entity === 'priorityWeights')
    assert.ok(entry)
    assert.equal(entry.action, 'weights')
    assert.ok(entry.metadata)
    const metadata = JSON.parse(entry.metadata ?? '{}') as {
      old?: { severity?: number }
      new?: { severity?: number; usersAffected?: number }
    }
    assert.equal(metadata.old?.severity, 40)
    assert.equal(metadata.new?.severity, 0)
    assert.equal(metadata.new?.usersAffected, 10)
  })

  it('keeps a missing month missing and never turns it into zero', async () => {
    const workspace = await loadWorkspace(app, admin)
    const analysis = analyse(workspace)
    const workshop = analysis.utilities.meters.find((meter) => meter.meter.id === 'mtr-bv-main-e1')
    assert.ok(workshop)
    const missing = workshop.periods.find((period) => period.readingId === 'rea-bv-e-05')
    assert.ok(missing)
    assert.equal(missing.kind, 'missing')
    assert.equal(missing.consumption, null, 'a missing reading is null, not 0')
    assert.ok(workshop.knownConsumption > 0)

    const markdown = buildReportMarkdown({
      workspace,
      analysis,
      preparedBy: 'Test Administrator',
      roleLabel: 'Administrator',
    })
    assert.match(markdown, /No value recorded for May 2026/)
    assert.match(markdown, /Missing is never zero|missing readings stay missing/i)
  })

  it('writes no cost number when the tariff rate is blank', async () => {
    const workspace = await loadWorkspace(app, admin)
    const analysis = analyse(workspace)
    const electricity = analysis.utilities.totals.electricity
    assert.equal(electricity.cost, null, 'no rate is entered in the seed, so no cost is calculated')
    const markdown = buildReportMarkdown({
      workspace,
      analysis,
      preparedBy: 'Test Administrator',
      roleLabel: 'Administrator',
    })
    assert.match(markdown, /cost not calculated — no matching tariff rate entered/)
  })

  it('saves and clears a tariff without turning a blank rate into zero', async () => {
    const save = (ratePerUnit: number | null) => call(app, '/records/tariffs/trf-bv-e', {
      method: 'PATCH', session: admin, body: { data: { ratePerUnit } },
    })
    assert.equal((await save(8.5)).status, 200)
    let workspace = await loadWorkspace(app, admin)
    assert.ok((analyse(workspace).utilities.totals.electricity.cost ?? 0) > 0)
    assert.equal((await save(-1)).status, 422)
    assert.equal((await save(0)).status, 200)
    workspace = await loadWorkspace(app, admin)
    assert.equal(analyse(workspace).utilities.totals.electricity.cost, 0, 'an explicit zero rate remains zero')
    assert.equal((await save(null)).status, 200)
    workspace = await loadWorkspace(app, admin)
    assert.equal(workspace.dataset.tariffs.find((tariff) => tariff.id === 'trf-bv-e')?.ratePerUnit, null)
    assert.equal(analyse(workspace).utilities.totals.electricity.cost, null)
  })

  it('shows an Estimated meter without a spike flag while a Measured meter keeps its spike', async () => {
    const workspace = await loadWorkspace(app, admin)
    workspace.dataset.utilityMeters = workspace.dataset.utilityMeters.map((meter) => meter.id === 'mtr-bv-main-w1' ? { ...meter, measurementType: 'estimated' } : meter)
    const analysis = analyse(workspace)
    const waterMeter = analysis.utilities.meters.find((meter) => meter.meter.id === 'mtr-bv-main-w1')
    const measured = analysis.utilities.meters.find((meter) => meter.meter.id === 'mtr-bv-main-e1')
    assert.ok(waterMeter)
    assert.ok(measured)
    assert.equal(waterMeter.measurementType, 'estimated')
    assert.equal(waterMeter.spikes.length, 0, 'an Estimated meter cannot raise a leak prompt')
    assert.equal(measured.measurementType, 'measured')
    assert.ok(measured.spikes.length > 0, 'the measured series still produces its recorded spike')
  })

  it('tags every exported figure and carries threshold type and source', async () => {
    const workspace = await loadWorkspace(app, admin)
    const analysis = analyse(workspace)
    const markdown = buildReportMarkdown({
      workspace,
      analysis,
      preparedBy: 'Test Administrator',
      roleLabel: 'Administrator',
    })
    for (const tag of ['Measured', 'Estimated', 'Illustrative', 'Missing']) {
      assert.ok(markdown.includes(tag), `report must explain the ${tag} tag`)
    }
    assert.match(markdown, /\[Measured\]/)
    assert.match(markdown, /\[Estimated\]/)
    assert.match(markdown, /\[Illustrative\]/)
    assert.match(markdown, /Project assumption/)
    assert.match(markdown, /Campus water policy 2026/)
    assert.match(markdown, /Lighting, Waste and Parking have no rule/)
    assert.match(markdown, /Capacity \| Peak enrolled/)
    assert.match(markdown, /30 \[Measured\]/)
    assert.match(markdown, /Missing \[Missing\]/)
    assert.match(markdown, /Rooms rule and source/)
    assert.match(markdown, /Records behind the Overview counts/)
    for (const complaint of workspace.dataset.complaints.filter((row) => row.status === 'open' || row.status === 'in_progress')) {
      assert.ok(markdown.includes(complaint.id), 'the count has its backing database row IDs')
    }
    const welding = markdown.split('\n').find((line) => line.startsWith('| WS-1'))
    assert.ok(welding?.includes('Missing [Missing]'), 'missing capacity is tagged rather than exported as zero')

    const csv = buildReportCsv({ workspace, analysis, preparedBy: 'Test Administrator', roleLabel: 'Administrator' })
    assert.match(csv.split('\r\n')[0], /figure_tags/)
    for (const tag of ['Measured', 'Estimated', 'Illustrative', 'Missing']) assert.ok(csv.includes(`[${tag}]`))
    assert.match(csv, /Campus water policy 2026/)
    assert.match(csv, /Project assumption/)
    assert.match(csv, /100 m3 \[Illustrative\]/)
    assert.match(csv, /No value recorded for May 2026/)
    assert.match(csv, /Records behind the Overview counts/)
    assert.match(csv, /Missing \[Missing\]/)
    const guardedAnalysis = { ...analysis, plan: { ...analysis.plan, options: analysis.plan.options.map((option, index) => index === 0 ? { ...option, title: '=1+1' } : option) } }
    const guarded = buildReportCsv({ workspace, analysis: guardedAnalysis, preparedBy: 'Test Administrator', roleLabel: 'Administrator' })
    assert.ok(guarded.includes(`"'=1+1"`), 'formula-like record names are escaped for spreadsheets')
  })

  it('refuses every administrator area to Estates with 403', async () => {
    const checks: [string, string, unknown?][] = [
      ['GET', '/admin/audit'],
      ['GET', '/admin/ai-settings'],
      ['GET', '/admin/role-matrix'],
      ['POST', '/members', { username: 'estates-made-this', displayName: 'Estates Made This', password: 'x'.repeat(12), role: 'faculty' }],
      ['POST', '/import', { fileName: 'x.csv', mode: 'append', sheets: [] }],
    ]
    for (const [method, path, body] of checks) {
      const result = await call(app, path, {
        method: method as 'GET' | 'POST',
        session: estates,
        body,
      })
      assert.equal(result.status, 403, `${method} ${path} must be refused for Estates`)
    }
  })

  it('allows the administrator to read the same areas', async () => {
    const audit = await call(app, '/admin/audit', { session: admin })
    const ai = await call<{
      configured: boolean
      model: string | null
      callsToday: number
      rejectedToday: number
      dataNote: string
    }>(app, '/admin/ai-settings', { session: admin })
    const matrix = await call<{ capabilities: unknown[] }>(app, '/admin/role-matrix', { session: admin })
    assert.equal(audit.status, 200)
    assert.equal(ai.status, 200)
    assert.equal(ai.payload.configured, false)
    assert.equal(ai.payload.model, null)
    assert.ok(ai.payload.callsToday >= 0)
    assert.ok(ai.payload.rejectedToday >= 0)
    assert.match(ai.payload.dataNote, /Text you type in a report/)
    assert.equal(matrix.status, 200)
    assert.ok(matrix.payload.capabilities.length > 0)
  })
})
