import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { createServer, type Server } from 'node:http'
import { createDatabase, applyNearbyDemoSeed } from '../server/db.ts'
import type { Database } from '../server/db.ts'
import { createMicrocityApp } from '../server/app.ts'
import { analyseNearby, analyseWorkspace, buildGapItems, rankNearby, NEARBY_RULE_LABEL } from '../src/domain/analysis/index.ts'
import type { Finding } from '../src/domain/analysis/index.ts'
import { DEFAULT_PRIORITY_WEIGHTS, NEARBY_TYPE_LABELS } from '../src/domain/types.ts'
import type { NearbyAsset, WorkspacePayload } from '../src/domain/types.ts'
import { buildReportCsv, buildReportMarkdown } from '../src/lib/reports.ts'

const AS_OF = '2026-11-14T10:00:00Z'
const fixture: NearbyAsset = {
  id: 'near-test', collegeId: 'clg-bv', type: 'streetlight',
  locationDescription: 'Test location — Illustrative', distanceMetres: 15, distanceBasis: 'estimated',
  condition: 'good', dailyUsers: null, usersMethod: null,
  responsibleAuthority: 'Test authority — Illustrative', basis: 'illustrative',
}

const ruleCases: [string, NearbyAsset['condition'][], string][] = [
  ['empty type', [], 'not_enough_data'],
  ['all Not recorded', [null, null], 'not_enough_data'],
  ['all Good', ['good', 'good'], 'adequate'],
  ['some Fair', ['good', 'fair'], 'stressed'],
  ['fewer than half Poor', ['poor', 'good', 'good'], 'stressed'],
  ['half Poor', ['poor', 'good'], 'critical'],
  ['more than half Poor', ['poor', 'poor', 'fair'], 'critical'],
  ['unknowns excluded from denominator', ['poor', 'good', null, null], 'critical'],
  ['Good with unknown condition', ['good', null], 'adequate'],
]

describe('Phase F — nearby condition rules', () => {
  for (const [name, conditions, expected] of ruleCases) {
    it(`${name}: ${JSON.stringify(conditions)} => ${expected}`, () => {
      const rows = analyseNearby(conditions.map((condition, index) => ({ ...fixture, id: `test-${index}`, condition })))
      assert.equal(rows.length, 5)
      assert.equal(rows[0].status, expected)
      assert.equal(rows[0].dailyUsers, null)
      assert.match(rows[0].demand, /Not entered/)
      assert.equal(rows[0].unknown, conditions.filter((value) => value === null).length)
    })
  }

  it('users never decide status and order ties only, with missing after explicit zero', () => {
    const rows = analyseNearby([
      { ...fixture, id: 'critical-small', condition: 'poor', dailyUsers: 1, usersMethod: 'Test' },
      { ...fixture, id: 'critical-big', type: 'footpath', condition: 'poor', dailyUsers: 10, usersMethod: 'Test' },
      { ...fixture, id: 'stressed-big', type: 'transport_stop', condition: 'fair', dailyUsers: 9999, usersMethod: 'Test' },
      { ...fixture, id: 'good-missing', type: 'drinking_water' },
      { ...fixture, id: 'good-zero', type: 'drain_waste', dailyUsers: 0, usersMethod: 'Test' },
    ])
    assert.deepEqual(rankNearby(rows).map((row) => row.type), ['footpath', 'streetlight', 'transport_stop', 'drain_waste', 'drinking_water'])
    assert.equal(rows[2].status, 'stressed')
    assert.equal(rows[3].dailyUsers, null)
    assert.equal(rows[4].dailyUsers, 0)
  })

  it('deduplicates critical items and attaches noPlanYet instead of counting it again', () => {
    const finding: Finding = { id: 'capacity-room-a', module: 'capacity', severity: 'critical', title: 'Room A', summary: '', evidence: [], limitations: [], subjectIds: ['room-a'], facts: {} }
    const gaps = buildGapItems([finding, { ...finding, id: 'capacity-room-a-second-evidence' }], [])
    assert.equal(gaps.length, 1)
    assert.equal(gaps[0].noPlanYet, true)
    assert.equal(gaps[0].findingIds.length, 2)
    assert.equal(buildGapItems([finding], ['capacity-room-a'])[0].noPlanYet, false)
  })
})

describe('Phase F — HTTP access, evidence and exports', () => {
  let db: Database
  let server: Server
  let base: string
  const cookies: Record<string, string> = {}

  async function request(path: string, username = 'sample-admin', method = 'GET', body?: unknown, collegeId = username.startsWith('sample-fd') ? 'clg-fd' : 'clg-bv') {
    const response = await fetch(`${base}/api${path}`, {
      method, headers: { Cookie: cookies[username], 'X-College-Id': collegeId, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, payload: await response.json() as Record<string, any> }
  }
  async function workspace(username = 'sample-admin') {
    const response = await request('/workspace', username)
    assert.equal(response.status, 200)
    return response.payload as WorkspacePayload
  }
  const save = (data: Record<string, unknown>, username = 'sample-admin') => request('/records/nearbyAssets', username, 'POST', { data })

  before(async () => {
    db = createDatabase(':memory:', true)
    const app = createMicrocityApp({ db, env: {} })
    server = createServer((req, res) => { void app.handle(req, res).then((handled) => {
      if (!handled) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}') }
    }) })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    base = `http://127.0.0.1:${address.port}`
    for (const username of ['sample-admin', 'sample-fd-admin', 'sample-estates', 'sample-student', 'sample-maintenance', 'sample-faculty']) {
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: `${username}-pass` }),
      })
      assert.equal(response.status, 200)
      cookies[username] = response.headers.get('set-cookie')!.split(';')[0]
    }
  })
  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    db.close()
  })

  it('Admin A creates; every college role reads; Admin B cannot read, edit or delete A records', async () => {
    assert.equal((await save({ ...fixture })).status, 201)
    for (const username of ['sample-admin', 'sample-estates', 'sample-student', 'sample-maintenance', 'sample-faculty']) {
      const data = await workspace(username)
      assert.ok(data.dataset.nearbyAssets.some((asset) => asset.id === fixture.id), username)
    }
    assert.deepEqual((await workspace('sample-fd-admin')).dataset.nearbyAssets, [])
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const result = await request(`/records/nearbyAssets/${fixture.id}`, 'sample-fd-admin', method, method === 'PATCH' ? { data: { condition: 'poor' } } : undefined)
      assert.ok([403, 404].includes(result.status), method)
    }
    assert.equal((await request('/workspace', 'sample-fd-admin', 'GET', undefined, 'clg-bv')).status, 403)
    assert.equal((await request(`/records/nearbyAssets/${fixture.id}`, 'sample-fd-admin', 'PATCH', { data: { condition: 'poor' } }, 'clg-bv')).status, 403)
  })

  it('Estates, student, faculty and maintenance saves and deletes receive 403', async () => {
    for (const username of ['sample-estates', 'sample-student', 'sample-faculty', 'sample-maintenance']) {
      assert.equal((await save({ ...fixture, id: `denied-${username}` }, username)).status, 403)
      assert.equal((await request(`/records/nearbyAssets/${fixture.id}`, username, 'PATCH', { data: { condition: 'poor' } })).status, 403)
      assert.equal((await request(`/records/nearbyAssets/${fixture.id}`, username, 'DELETE')).status, 403)
    }
  })

  it('daily users without a method receive 422 on create and edit, including explicit zero', async () => {
    for (const dailyUsers of [0, 17]) {
      assert.equal((await save({ ...fixture, id: `no-method-${dailyUsers}`, dailyUsers, usersMethod: '  ' })).status, 422)
      assert.equal((await request(`/records/nearbyAssets/${fixture.id}`, 'sample-admin', 'PATCH', { data: { dailyUsers, usersMethod: '' } })).status, 422)
    }
    assert.equal((await save({ ...fixture, id: 'fraction-users', dailyUsers: 1.5, usersMethod: 'Test' })).status, 422)
    assert.equal((await save({ ...fixture, id: 'negative-users', dailyUsers: -1, usersMethod: 'Test' })).status, 422)
    assert.equal((await save({ ...fixture, id: 'bad-type', type: 'road' })).status, 422)
    assert.equal((await save({ ...fixture, id: 'bad-distance', distanceMetres: -1 })).status, 422)
  })

  it('defaults distance to Estimated and keeps blank users null through editing, workspace and export', async () => {
    const created = await save({ ...fixture, id: 'blank-users', distanceBasis: undefined, dailyUsers: '' })
    assert.equal(created.status, 201)
    assert.equal(created.payload.record.distanceBasis, 'estimated')
    assert.equal(created.payload.record.dailyUsers, null)
    assert.equal((await request('/records/nearbyAssets/blank-users', 'sample-admin', 'PATCH', { data: { dailyUsers: 0, usersMethod: 'Illustrative zero fixture', condition: 'poor' } })).status, 200)
    const cleared = await request('/records/nearbyAssets/blank-users', 'sample-admin', 'PATCH', { data: { dailyUsers: '', id: 'cannot-rename', collegeId: 'clg-fd' } })
    assert.equal(cleared.status, 200)
    assert.equal(cleared.payload.record.id, 'blank-users')
    assert.equal(cleared.payload.record.collegeId, 'clg-bv')
    assert.equal(cleared.payload.record.dailyUsers, null)
    assert.equal(cleared.payload.record.usersMethod, null)
    const current = await workspace()
    assert.equal(current.dataset.nearbyAssets.find((asset) => asset.id === 'blank-users')!.dailyUsers, null)
    const input = { workspace: current, analysis: analyseWorkspace(current.dataset, AS_OF, current.priorityWeights), preparedBy: 'Test', roleLabel: 'Administrator' }
    const markdown = buildReportMarkdown(input)
    const csv = buildReportCsv(input)
    for (const text of [markdown, csv]) {
      for (const label of Object.values(NEARBY_TYPE_LABELS)) assert.ok(text.includes(label))
      assert.ok(text.includes(NEARBY_RULE_LABEL))
      assert.ok(text.includes('[Illustrative]'))
      assert.ok(text.includes('[Estimated]'))
      assert.ok(text.includes('Not entered [Missing]'))
      assert.ok(text.includes('How obtained'))
    }
    assert.match(markdown.split('\n').find((line) => line.startsWith('| blank-users |'))!, /Not entered \[Missing\]/)
    assert.ok(csv.split('\r\n').some((line) => line.includes('blank-users') && line.includes('Daily users') && line.includes('Not entered [Missing]')))
  })

  it('critical gap count excludes plan wrappers and includes one item per critical nearby type', async () => {
    const current = await workspace()
    const analysis = analyseWorkspace(current.dataset, AS_OF, current.priorityWeights)
    assert.ok(analysis.findings.some((finding) => finding.id === 'plan-unaddressed-capacity-rm-bv-101'))
    assert.equal(analysis.gaps.filter((gap) => gap.id === 'capacity-rm-bv-101').length, 1)
    assert.ok(analysis.gaps.find((gap) => gap.id === 'capacity-rm-bv-101')!.noPlanYet)
    assert.ok(!analysis.gaps.some((gap) => gap.id.startsWith('plan-unaddressed-')))
    assert.equal(analysis.gaps.filter((gap) => gap.id === 'nearby-footpath').length, 1)
    assert.equal(analysis.gaps.find((gap) => gap.id === 'nearby-footpath')!.severity, 'critical')
    assert.ok(analysis.gaps.filter((gap) => gap.severity === 'critical').length < analysis.findingCounts.critical)
  })

  it('negative and all-zero priority weights receive 422 without changing saved settings', async () => {
    const before = (await workspace()).priorityWeights
    for (const field of ['severity', 'condition', 'usersAffected', 'daysOpen']) {
      const result = await request('/priority-weights', 'sample-admin', 'PATCH', { ...DEFAULT_PRIORITY_WEIGHTS, [field]: -1 })
      assert.equal(result.status, 422)
    }
    assert.equal((await request('/priority-weights', 'sample-admin', 'PATCH', { severity: 0, condition: 0, usersAffected: 0, daysOpen: 0 })).status, 422)
    assert.deepEqual((await workspace()).priorityWeights, before)
  })

  it('prints and verifies ranking before and after a saved weight change', async () => {
    const before = await workspace()
    const first = analyseWorkspace(before.dataset, AS_OF, before.priorityWeights).maintenance.ranked.map((row) => row.complaintId)
    assert.equal((await request('/priority-weights', 'sample-admin', 'PATCH', { severity: 0, condition: 0, usersAffected: 10, daysOpen: 10 })).status, 200)
    const after = await workspace()
    const second = analyseWorkspace(after.dataset, AS_OF, after.priorityWeights).maintenance.ranked.map((row) => row.complaintId)
    assert.notDeepEqual(first, second)
    console.log('PHASE F WEIGHTS BEFORE', JSON.stringify(before.priorityWeights), 'ORDER', JSON.stringify(first))
    console.log('PHASE F WEIGHTS AFTER', JSON.stringify(after.priorityWeights), 'ORDER', JSON.stringify(second))
  })

  it('public issues are college-scoped: other colleges see none of list, detail or updates; reporter stays inside its college', async () => {
    const a = await workspace()
    const b = await workspace('sample-fd-admin')
    // Phase G: viewing is college-scoped. ui-1/ui-2/ui-3 were reported by
    // clg-bv accounts, ui-4 by a clg-fd account, so each college sees only
    // its own reports — the other college's list is empty of them.
    assert.ok(a.dataset.urbanIssues.every((issue) => ['ui-1', 'ui-2', 'ui-3'].includes(issue.id)))
    assert.ok(b.dataset.urbanIssues.every((issue) => issue.id === 'ui-4'))
    assert.equal(a.dataset.urbanIssues.some((issue) => issue.id === 'ui-4'), false)
    assert.equal(b.dataset.urbanIssues.some((issue) => issue.id === 'ui-2'), false)
    assert.equal(a.dataset.urbanAssets.length, b.dataset.urbanAssets.length)
    const same = a.dataset.urbanIssues.find((issue) => issue.id === 'ui-2')!
    assert.ok(same.reporterName)
    // Another college cannot see, update or even fetch the issue.
    const detail = await request('/records/urbanIssues/ui-2', 'sample-fd-admin')
    assert.ok([403, 404].includes(detail.status))
    const updated = await request('/records/urbanIssues/ui-2', 'sample-fd-admin', 'PATCH', { data: { status: 'in_progress', note: 'Cross-college attempt' } })
    assert.ok([403, 404].includes(updated.status))
    // Inside the owning college the reporter identity is visible and an
    // update by its own admin keeps the reporter fields intact.
    const own = await request('/records/urbanIssues/ui-2', 'sample-admin', 'PATCH', { data: { status: 'in_progress', note: 'Own-college update' } })
    assert.equal(own.status, 200)
    assert.ok(own.payload.record.reporterName)
    assert.ok(!JSON.stringify(own.payload).includes('reporterCollegeId'))
  })

  it('new reports keep their origin college for scoping even when the reporter later joins both colleges', async () => {
    const created = await request('/records/urbanIssues', 'sample-student', 'POST', { data: {
      category: 'Test nearby issue', severity: 'low', description: 'Illustrative test report, no real location.',
      locationLabel: 'Test location', authority: 'Test authority', reporterCollegeId: 'clg-fd', reporterName: 'Spoofed', reporterUsername: 'Spoofed',
    } })
    assert.equal(created.status, 201)
    db.addMembership('usr-bv-student', 'clg-fd', 'student')
    // The origin college is the reporter's own college (clg-bv), never a
    // spoofable field: the issue is scoped to clg-bv and is invisible to
    // clg-fd even though the reporter now also belongs there.
    const fdWorkspace = await workspace('sample-fd-admin')
    assert.equal(fdWorkspace.dataset.urbanIssues.some((issue) => issue.id === created.payload.record.id), false)
    const bvWorkspace = await workspace('sample-admin')
    const publicIssue = bvWorkspace.dataset.urbanIssues.find((issue) => issue.id === created.payload.record.id)!
    assert.ok(publicIssue)
    assert.equal(db.getRecord(created.payload.record.id)!.collegeId, null)
    assert.equal(db.getRecord(created.payload.record.id)!.data.reporterCollegeId, 'clg-bv')
    assert.ok(!('reporterCollegeId' in publicIssue))
  })

  it('Admin A deletes its nearby record and the deletion is audited', async () => {
    assert.equal((await request('/records/nearbyAssets/blank-users', 'sample-admin', 'DELETE')).status, 200)
    assert.ok(!(await workspace()).dataset.nearbyAssets.some((asset) => asset.id === 'blank-users'))
    assert.ok(db.listAudit('clg-bv').some((entry) => entry.action === 'delete' && entry.entityId === 'blank-users'))
  })
})

describe('Phase F — additive illustrative seed', () => {
  it('runs once, does not rename or overwrite records, and never resurrects a deleted seed record', () => {
    const db = createDatabase(':memory:', true)
    try {
      const records = db.listRecords('nearbyAssets', 'clg-bv')
      assert.equal(records.length, 3)
      assert.ok(records.every((row) => row.source === 'seed' && row.data.basis === 'illustrative'))
      assert.equal(db.listRecords('nearbyAssets', 'clg-fd').length, 0)
      const auditCount = db.listAudit('clg-bv').length
      applyNearbyDemoSeed(db)
      assert.deepEqual(db.listRecords('nearbyAssets', 'clg-bv'), records)
      assert.equal(db.listAudit('clg-bv').length, auditCount)
      db.deleteRecord(records[0].id)
      applyNearbyDemoSeed(db)
      assert.equal(db.listRecords('nearbyAssets', 'clg-bv').length, 2)
    } finally { db.close() }
  })

  it('does not seed without the approved provenance name', () => {
    const db = createDatabase(':memory:', false)
    try {
      db.setMeta('baseDataset', 'unapproved-source')
      applyNearbyDemoSeed(db)
      assert.equal(db.listRecords('nearbyAssets', 'clg-bv').length, 0)
      assert.equal(db.getMeta('nearby-demo-seed-v1'), null)
    } finally { db.close() }
  })
})
