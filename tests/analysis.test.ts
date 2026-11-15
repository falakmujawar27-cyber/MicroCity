import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SEED_ASSETS,
  SEED_BUILDINGS,
  SEED_COMPLAINTS,
  SEED_COMPLAINT_UPDATES,
  SEED_DECISIONS,
  SEED_INSPECTIONS,
  SEED_METERS,
  SEED_PLAN_OPTIONS,
  SEED_READINGS,
  SEED_ROOMS,
  SEED_TARIFFS,
  SEED_TIMETABLE,
  SEED_URBAN_ASSETS,
  SEED_URBAN_ISSUES,
} from '../server/seed.ts'
import type { DatasetSources } from '../src/domain/types.ts'
import {
  analyseMaintenance,
  analyseNeeds,
  analysePlan,
  analyseUtilities,
  analyseWorkspace,
  NEEDS_THRESHOLDS,
  SPIKE_RULE,
} from '../src/domain/analysis/index.ts'

const AS_OF = '2026-10-25T12:00:00Z'

// Cost arithmetic is tested with an explicit fixture. The seeded tariffs are
// deliberately blank, so they cannot stand in for a real or test price.
const TEST_TARIFFS: DatasetSources['tariffs'] = [
  {
    id: 'test-trf-bv-e',
    collegeId: 'clg-bv',
    utility: 'electricity',
    unit: 'kWh',
    currency: 'INR',
    ratePerUnit: 8.5,
    standingChargePerPeriod: 500,
    effectiveFrom: '2026-01-01',
    note: 'Test fixture only; not a real tariff.',
  },
  {
    id: 'test-trf-bv-w',
    collegeId: 'clg-bv',
    utility: 'water',
    unit: 'm3',
    currency: 'INR',
    ratePerUnit: 25,
    standingChargePerPeriod: 300,
    effectiveFrom: '2026-01-01',
    note: 'Test fixture only; not a real tariff.',
  },
]

function campus<T extends { collegeId: string }>(rows: T[]): T[] {
  return rows.filter((row) => row.collegeId === 'clg-bv')
}

function dataset(): DatasetSources {
  return {
    buildings: campus(SEED_BUILDINGS),
    rooms: campus(SEED_ROOMS),
    timetableSlots: campus(SEED_TIMETABLE),
    assets: campus(SEED_ASSETS),
    inspections: campus(SEED_INSPECTIONS),
    utilityMeters: campus(SEED_METERS),
    utilityReadings: campus(SEED_READINGS),
    tariffs: TEST_TARIFFS,
    complaints: campus(SEED_COMPLAINTS),
    complaintUpdates: campus(SEED_COMPLAINT_UPDATES),
    planOptions: campus(SEED_PLAN_OPTIONS),
    decisions: campus(SEED_DECISIONS),
    nearbyAssets: [],
    urbanAssets: SEED_URBAN_ASSETS,
    urbanIssues: SEED_URBAN_ISSUES,
  }
}

test('seed tariffs are blank placeholders and never a claimed price', () => {
  assert.ok(SEED_TARIFFS.length > 0)
  for (const tariff of SEED_TARIFFS) {
    assert.equal(tariff.ratePerUnit, null)
    assert.equal(tariff.standingChargePerPeriod, null)
    assert.match(String(tariff.note), /enter the rate from your bill/i)
  }
})

test('capacity: seat shortfalls, missing capacity and overlaps are evidence-based', () => {
  const data = dataset()
  const needs = analyseNeeds(data.rooms, data.timetableSlots, data.buildings, data.complaints, AS_OF)

  const lecture = needs.rooms.find((room) => room.roomId === 'rm-bv-101')
  assert.ok(lecture)
  assert.equal(lecture.expectedPeak, 42)
  assert.equal(lecture.maxShortageSeats, 12)
  assert.equal(lecture.status, 'critical')
  assert.ok((lecture.score ?? 0) >= NEEDS_THRESHOLDS.critical)
  assert.equal(lecture.slots.find((slot) => slot.slotId === 'tlt-bv-1')?.utilisation, 1.3)

  const hvac = needs.rooms.find((room) => room.roomId === 'rm-bv-201')
  assert.ok(hvac)
  assert.equal(hvac.maxShortageSeats, 14)
  assert.equal(hvac.averageUtilisation, null)
  assert.equal(hvac.status, 'stressed')
  const hvacFinding = needs.findings.find((finding) => finding.id === 'capacity-rm-bv-201')
  assert.equal(hvacFinding?.severity, 'high')
  assert.ok(needs.overlaps.some((overlap) => overlap.roomId === 'rm-bv-201' && overlap.minutes === 60))

  const welding = needs.rooms.find((room) => room.roomId === 'rm-bv-ws1')
  assert.ok(welding)
  assert.equal(welding.capacity, null)
  assert.equal(welding.score, null)
  assert.equal(welding.status, 'unavailable')
  assert.ok(welding.missingInputs.some((input) => input.includes('Seat capacity')))
  assert.ok(needs.findings.some((finding) => finding.id === 'capacity-missing-rm-bv-ws1'))

  const seminar = needs.rooms.find((room) => room.roomId === 'rm-bv-102')
  assert.ok(seminar)
  assert.equal(seminar.averageUtilisation, 0.25)
  assert.ok(needs.findings.some((finding) => finding.id === 'capacity-underuse-rm-bv-102'))
})

test('utilities: interval, cumulative, missing values, resets, spikes and cost estimates', () => {
  const data = dataset()
  const estimatedMeters = data.utilityMeters.map((meter) => meter.id === 'mtr-bv-main-w1' ? { ...meter, measurementType: 'estimated' as const } : meter)
  const utilities = analyseUtilities(estimatedMeters, data.utilityReadings, data.tariffs, data.buildings)

  const electricity = utilities.meters.find((meter) => meter.meter.id === 'mtr-bv-main-e1')
  assert.ok(electricity)
  assert.equal(electricity.missingReadings, 1)
  assert.equal(electricity.quality, 'limited')
  assert.ok(electricity.gaps.some((gap) => gap.readingId === 'rea-bv-e-05' && gap.kind === 'missing-value'))
  assert.equal(electricity.periods.find((period) => period.readingId === 'rea-bv-e-05')?.consumption, null)
  const september = electricity.periods.find((period) => period.readingId === 'rea-bv-e-09')
  assert.equal(september?.isSpike, true)
  assert.equal(september?.baseline, 8550)
  assert.equal(september?.cost, 118830)
  assert.ok(utilities.findings.some((finding) => finding.id === 'utility-spike-rea-bv-e-09'))
  assert.ok(utilities.findings.some((finding) => finding.id === 'utility-gap-rea-bv-e-05'))

  const water = utilities.meters.find((meter) => meter.meter.id === 'mtr-bv-main-w1')
  assert.ok(water)
  assert.equal(water.periods.find((period) => period.readingId === 'rea-bv-w-10')?.kind, 'reset')
  assert.equal(water.periods.find((period) => period.readingId === 'rea-bv-w-10')?.consumption, null)
  assert.equal(water.resets.length, 1)
  assert.equal(water.measurementType, 'estimated')
  assert.equal(water.spikes.length, 0, 'Estimated readings cannot produce a leak prompt')
  assert.ok(water.periods.every((period) => period.consumption === null || period.consumption >= 0))

  const workshop = utilities.meters.find((meter) => meter.meter.id === 'mtr-bv-ws-e1')
  assert.ok(workshop)
  assert.equal(workshop.knownPeriods, 4)
  assert.ok(utilities.findings.some((finding) => finding.id === 'utility-mtr-bv-ws-e1'))

  assert.equal(utilities.totals.electricity.unit, 'kWh')
  assert.equal(utilities.totals.electricity.currency, 'INR')
  assert.ok((utilities.totals.electricity.consumption ?? 0) > 0)
  assert.equal(utilities.spikeCount, 1, 'only the Measured electricity series is spike-tested')
  assert.equal(utilities.resetCount, 1)
  assert.ok(SPIKE_RULE.minimumPeriods >= 4)
})

test('maintenance: deterministic priority, repeat grouping and inspection alerts', () => {
  const data = dataset()
  const maintenance = analyseMaintenance(
    data.rooms,
    data.buildings,
    data.assets,
    data.inspections,
    data.complaints,
    data.urbanIssues,
    data.urbanAssets,
    AS_OF,
  )

  const welding = maintenance.ranked.find((priority) => priority.complaintId === 'cmp-bv-welding')
  assert.ok(welding)
  assert.equal(welding.band, 'P2')
  assert.equal(welding.score, 60)
  assert.equal(welding.repeatCount, 0)

  const projector = maintenance.ranked.find((priority) => priority.complaintId === 'cmp-bv-projector')
  assert.ok(projector)
  assert.equal(projector.repeatCount, 0)
  assert.equal(projector.components.find((component) => component.key === 'people')?.points, 12)

  assert.ok(!maintenance.ranked.some((priority) => priority.complaintId === 'cmp-bv-window'))
  assert.equal(maintenance.closedCount, 4)
  for (let index = 1; index < maintenance.ranked.length; index += 1) {
    assert.ok(maintenance.ranked[index - 1].score >= maintenance.ranked[index].score)
  }

  const ahuRepeat = maintenance.repeats.find((repeat) => repeat.targetId === 'ast-bv-ahu')
  assert.ok(ahuRepeat)
  assert.equal(ahuRepeat.count, 3)
  assert.equal(ahuRepeat.openCount, 1)
  const plumbingRepeat = maintenance.repeats.find((repeat) => repeat.targetId === 'rm-bv-102')
  assert.ok(plumbingRepeat)
  assert.equal(plumbingRepeat.count, 2)
  assert.ok(maintenance.findings.some((finding) => finding.id === ahuRepeat.id))

  assert.ok(maintenance.inspectionAlerts.some((alert) => alert.kind === 'overdue' && alert.assetId === 'ast-bv-boiler'))
  assert.ok(maintenance.inspectionAlerts.some((alert) => alert.assetId === 'ast-bv-lift' && alert.kind === 'interval-due-soon'))
  assert.ok(maintenance.findings.some((finding) => finding.id === 'maintenance-cmp-bv-welding'))
  assert.ok(maintenance.openPublicIssues >= 1)
})

test('plan: option facts, linked findings, decisions and unaddressed risks', () => {
  const data = dataset()
  const needs = analyseNeeds(data.rooms, data.timetableSlots, data.buildings, data.complaints, AS_OF)
  const utilities = analyseUtilities(data.utilityMeters, data.utilityReadings, data.tariffs, data.buildings)
  const maintenance = analyseMaintenance(
    data.rooms,
    data.buildings,
    data.assets,
    data.inspections,
    data.complaints,
    data.urbanIssues,
    data.urbanAssets,
    AS_OF,
  )
  const plan = analysePlan(data.planOptions, data.decisions, [
    ...needs.findings,
    ...utilities.findings,
    ...maintenance.findings,
  ])

  const retime = plan.options.find((option) => option.optionId === 'opt-bv-retime')
  assert.ok(retime)
  assert.equal(retime.finding?.id, 'capacity-rm-bv-201')
  assert.equal(retime.seatEffect, 20)
  assert.equal(retime.seatEffectComplete, true)
  assert.equal(retime.simplePaybackMonths, null)
  assert.equal(retime.approvalState, 'approved')
  assert.equal(retime.decision?.ownerUserId, 'usr-bv-estates')

  const room = plan.options.find((option) => option.optionId === 'opt-bv-room')
  assert.ok(room)
  assert.equal(room.approvalState, 'proposed')
  assert.equal(room.annualSavings, null)
  assert.match(room.paybackNote, /savings are not recorded/i)

  const sensor = plan.options.find((option) => option.optionId === 'opt-bv-sensor')
  assert.ok(sensor)
  assert.equal(sensor.finding?.id, 'utility-mtr-bv-ws-e1')
  assert.equal(sensor.seatEffect, null)
  assert.ok(sensor.missingNumericFields.includes('Annual savings'))
  assert.equal(plan.approvalCounts.approved, 1)
  assert.equal(plan.approvalCounts.proposed, 1)
  assert.equal(plan.approvalCounts.none, 1)
  assert.ok(plan.unaddressedFindings.some((finding) => finding.id === 'utility-spike-rea-bv-e-09'))
  assert.ok(plan.unaddressedFindings.some((finding) => finding.id === 'capacity-rm-bv-101'))
  assert.ok(plan.findings.some((finding) => finding.id === 'plan-unaddressed-capacity-rm-bv-101'))
})

test('workspace analysis is deterministic, sorted and free of duplicate finding ids', () => {
  const first = analyseWorkspace(dataset(), AS_OF)
  const second = analyseWorkspace(dataset(), AS_OF)
  assert.deepEqual(first, second)
  assert.equal(first.findingCounts.critical + first.findingCounts.high + first.findingCounts.medium + first.findingCounts.low + first.findingCounts.info, first.findings.length)
  assert.equal(new Set(first.findings.map((finding) => finding.id)).size, first.findings.length)
  for (let index = 1; index < first.findings.length; index += 1) {
    const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const
    assert.ok(rank[first.findings[index - 1].severity] <= rank[first.findings[index].severity])
  }
  assert.ok(first.capacity.shortages.length >= 2)
  assert.ok(first.utilities.spikeCount >= 1)
  assert.ok(first.maintenance.ranked.length >= 5)
  assert.ok(first.plan.options.length === 3)
})
