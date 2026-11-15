/**
 * The five Needs and Gaps categories, built only from recorded data.
 *
 * Rooms use the existing capacity/needs analysis. Water has readings but no
 * recorded capacity or limit; Lighting has public asset records but no fault
 * counts; Waste and Parking have no records at all. Those categories are shown
 * as Not enough data rather than inventing a threshold or a status.
 */
import type { DatasetSources, NeedsLimitConfig } from '../types.ts'
import { THRESHOLD_KIND_LABELS } from '../types.ts'
import { NEEDS_THRESHOLDS } from './capacity.ts'
import type { NeedsAnalysis } from './capacity.ts'
import type { MeterAnalysis, UtilitiesAnalysis } from './utilities.ts'
import type { Finding } from './types.ts'
import { formatDate } from '../../lib/format.ts'

export type NeedsCategoryKey = 'rooms' | 'water' | 'lighting' | 'waste' | 'parking'
export type NeedsCategoryStatus = 'critical' | 'stressed' | 'adequate' | 'not_enough_data'

export interface NeedsCategoryFacts {
  /** Enrolled demand: the highest expected class size in the focus room. */
  enrolled: number | null
  /** Seats in that room. */
  seats: number | null
  roomCode: string | null
  /** Recorded present total. Not shown: different sessions are different classes. */
  present: number | null
  /** Average present per recorded session in the focus room, never a sum. */
  averagePresent: number | null
  /** The Needs Score of the focus room; this is the number the status band uses. */
  decidingScore: number | null
  sessionsUsed: number
  sessionsTotal: number
}

export interface NeedsCategoryRow {
  key: NeedsCategoryKey
  label: string
  /** One line: demand against capacity, or why it cannot be stated. */
  demand: string
  status: NeedsCategoryStatus
  statusLabel: string
  facts: NeedsCategoryFacts
  /** Two or three rule-based lines naming the rule and its source. */
  why: string[]
  /** Short "How is this calculated?" panel, including the same facts. */
  method: string[]
  /** Findings that currently feed this category. */
  findingIds: string[]
}

const THRESHOLD_SOURCE = 'Project assumption (not a published norm)'

export const NEEDS_CATEGORY_LABELS: Record<NeedsCategoryKey, string> = {
  rooms: 'Rooms',
  water: 'Water',
  lighting: 'Lighting',
  waste: 'Waste',
  parking: 'Parking',
}

export const NEEDS_STATUS_LABELS: Record<NeedsCategoryStatus, string> = {
  critical: 'Critical',
  stressed: 'Stressed',
  adequate: 'Adequate',
  not_enough_data: 'Not enough data',
}

function percent(value: number, base: number): number {
  return base > 0 ? Math.round((value / base) * 100) : 0
}

function buildRooms(capacity: NeedsAnalysis, findings: Finding[]): NeedsCategoryRow {
  const profiles = capacity.rooms
  const worstShortage = [...profiles]
    .filter((room) => room.maxShortageSeats !== null && room.maxShortageSeats > 0)
    .sort((a, b) => (b.maxShortageSeats ?? 0) - (a.maxShortageSeats ?? 0))[0]
  const peak = [...profiles]
    .filter((room) => room.expectedPeak !== null)
    .sort((a, b) => (b.expectedPeak ?? 0) - (a.expectedPeak ?? 0))[0]
  const highestScore = [...profiles]
    .filter((room) => room.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]
  const focus = highestScore ?? worstShortage ?? peak ?? null

  const present = profiles.reduce(
    (sum, room) =>
      sum +
      room.slots.reduce((inner, slot) => inner + (slot.attendance === null ? 0 : slot.attendance), 0),
    0,
  )
  const sessionsUsed = profiles.reduce((sum, room) => sum + room.attendedSlots, 0)
  const sessionsTotal = profiles.reduce((sum, room) => sum + room.slots.length, 0)

  const status: NeedsCategoryStatus = profiles.some((room) => room.status === 'critical')
    ? 'critical'
    : profiles.some((room) => room.status === 'stressed')
      ? 'stressed'
      : profiles.some((room) => room.status === 'adequate')
        ? 'adequate'
        : 'not_enough_data'

  const enrolled = focus?.expectedPeak ?? null
  const seats = focus?.capacity ?? null
  const roomCode = focus?.code ?? null
  const decidingScore = focus?.score ?? null
  const focusAttendance = focus
    ? focus.slots.map((slot) => slot.attendance).filter((value): value is number => value !== null)
    : []
  const averagePresent =
    focusAttendance.length > 0
      ? Math.round(focusAttendance.reduce((sum, value) => sum + value, 0) / focusAttendance.length)
      : null

  const demand =
    enrolled !== null && seats !== null
      ? `Enrolled ${enrolled} vs ${seats} seats (${percent(enrolled, seats)}%)`
      : enrolled !== null
        ? `Enrolled ${enrolled}; seats not recorded`
        : seats !== null
          ? `Enrolled not recorded; ${seats} seats`
          : 'No room demand or capacity is recorded'

  const why: string[] = []
  if (focus && enrolled !== null && seats !== null) {
    why.push(
      `Room ${focus.code} records ${enrolled} enrolled in its largest class against ${seats} seats (${percent(enrolled, seats)}% of capacity). Enrolled is the number shown; present attendance is not added across classes.`,
    )
  } else if (focus && enrolled !== null) {
    why.push(`Room ${focus.code} records ${enrolled} enrolled, but its seat capacity is not recorded.`)
  } else if (profiles.length === 0) {
    why.push('No rooms or timetable bookings are recorded for this college.')
  } else {
    why.push('No booking records both expected attendance and seat capacity.')
  }
  why.push(
    `Room status uses the Needs Score: Adequate below ${NEEDS_THRESHOLDS.stressed}, Stressed ${NEEDS_THRESHOLDS.stressed}-${NEEDS_THRESHOLDS.critical - 1}, Critical ${NEEDS_THRESHOLDS.critical} and above. Source: ${THRESHOLD_SOURCE}.`,
  )
  const presentTotal = sessionsUsed > 0 ? present : null
  if (sessionsTotal > 0) {
    why.push(
      presentTotal === null
        ? `${sessionsUsed} of ${sessionsTotal} sessions recorded with attendance and capacity; present is not treated as zero.`
        : `${sessionsUsed} of ${sessionsTotal} sessions recorded with attendance and capacity. Present attendance is shown as an average of ${averagePresent ?? 'not recorded'} per recorded session; it is never summed across classes because each session is a different group.`,
    )
  }

  const method = [
    'The row takes the worst room status from the existing Needs Score, so one critical room makes the category Critical.',
    `The demand number shown is enrolled — the largest expected class in room ${roomCode ?? 'not available'} (${enrolled ?? 'not recorded'}), against ${seats ?? 'not recorded'} seats. It is the capacity demand input to the Needs Score.`,
    `The status band is decided by the Needs Score (${decidingScore ?? 'not scored'} of 100), not by a present total. Average present (${averagePresent ?? 'not recorded'} per recorded session) feeds the occupancy component only.`,
    `Session coverage: ${sessionsUsed} of ${sessionsTotal} sessions recorded with both attendance and seat capacity.`,
    `Thresholds: Stressed at ${NEEDS_THRESHOLDS.stressed} and Critical at ${NEEDS_THRESHOLDS.critical} Needs Score points. Source: ${THRESHOLD_SOURCE}.`,
    'No administrator limit is used for Rooms in this build: the existing rule compares the Needs Score with fixed project-assumption bands, not a published norm limit.',
    ...capacity.methods,
  ]

  return {
    key: 'rooms',
    label: NEEDS_CATEGORY_LABELS.rooms,
    demand,
    status,
    statusLabel: NEEDS_STATUS_LABELS[status],
    facts: {
      enrolled,
      seats,
      roomCode,
      present: presentTotal,
      averagePresent,
      decidingScore,
      sessionsUsed,
      sessionsTotal,
    },
    why,
    method,
    findingIds: findings.filter((finding) => finding.module === 'capacity').map((finding) => finding.id),
  }
}

function buildWater(
  dataset: DatasetSources,
  utilities: UtilitiesAnalysis,
  limits: NeedsLimitConfig[],
): NeedsCategoryRow {
  const meters = utilities.meters.filter((entry) => entry.meter.utility === 'water')
  const meterIds = new Set(meters.map((entry) => entry.meter.id))
  const readings = dataset.utilityReadings.filter((reading) => meterIds.has(reading.meterId))
  const findings = utilities.findings.filter((finding) => {
    const meterId = String(finding.facts?.meterId ?? '')
    return meterId ? meterIds.has(meterId) : false
  })
  const limit = limits.find((entry) => entry.category === 'water') ?? null
  const emptyFacts: NeedsCategoryFacts = {
    enrolled: null,
    seats: null,
    roomCode: null,
    present: null,
    averagePresent: null,
    decidingScore: null,
    sessionsUsed: 0,
    sessionsTotal: 0,
  }

  if (meters.length === 0) {
    return {
      key: 'water',
      label: NEEDS_CATEGORY_LABELS.water,
      demand: 'Data missing',
      status: 'not_enough_data',
      statusLabel: NEEDS_STATUS_LABELS.not_enough_data,
      facts: emptyFacts,
      why: [
        'No water meters or readings are recorded for this college.',
        'A status needs recorded consumption and a limit; neither exists, so it is Not enough data.',
        ...(limit
          ? [
              `A ${limit.limit} ${limit.unit} limit is recorded (${THRESHOLD_KIND_LABELS[limit.kind]}; source: ${limit.source}), but there is no consumption to compare with it.`,
            ]
          : []),
      ],
      method: [
        'A category status compares recorded consumption with a recorded limit.',
        'A Water limit means the monthly consumption allowed for one water meter, in the unit the meter records (m3 in this dataset).',
        'No water meter is recorded, so no ratio is calculated.',
        ...utilities.methods,
      ],
      findingIds: findings.map((finding) => finding.id),
    }
  }

  if (!limit) {
    return {
      key: 'water',
      label: NEEDS_CATEGORY_LABELS.water,
      demand: `${readings.length} readings on ${meters.length} meter${meters.length === 1 ? '' : 's'}; no limit recorded`,
      status: 'not_enough_data',
      statusLabel: NEEDS_STATUS_LABELS.not_enough_data,
      facts: emptyFacts,
      why: [
        `Water readings exist (${readings.length} on ${meters.length} meter${meters.length === 1 ? '' : 's'}), but no consumption limit with a named source is recorded.`,
        'MicroCity does not invent a limit, so the category is Not enough data. An administrator can record the limit and its source in the threshold editor below; the readings themselves are on Resources.',
      ],
      method: [
        'A Water limit means the monthly consumption allowed for one water meter, in the unit the meter records (m3 in this dataset). The limit is not a percentage of capacity; it is a quantity per meter.',
        'Each water meter\'s latest known month is compared with the same limit. At or below the limit is Adequate; above it is Critical. No middle band or default limit is invented.',
        `No limit is recorded, so no ratio and no threshold are calculated. ${readings.length} reading(s) are not used to guess one.`,
        ...utilities.methods,
      ],
      findingIds: findings.map((finding) => finding.id),
    }
  }

  const matching = meters.filter((entry) => entry.meter.unit === limit.unit)
  const checked = matching.filter(
    (entry): entry is MeterAnalysis & { latestKnownConsumption: number } =>
      entry.latestKnownConsumption !== null,
  )

  if (checked.length === 0) {
    const reason =
      matching.length === 0
        ? `The limit is recorded in ${limit.unit}, but no water meter records ${limit.unit}.`
        : `No water meter records a known monthly consumption in ${limit.unit}.`
    return {
      key: 'water',
      label: NEEDS_CATEGORY_LABELS.water,
      demand: `${limit.limit} ${limit.unit}/month limit; no comparable consumption`,
      status: 'not_enough_data',
      statusLabel: NEEDS_STATUS_LABELS.not_enough_data,
      facts: emptyFacts,
      why: [
        reason,
        `Limit type: ${THRESHOLD_KIND_LABELS[limit.kind]}; source: ${limit.source}.`,
        'Consumption is not treated as zero, so no ratio is calculated.',
      ],
      method: [
        `Limit: ${limit.limit} ${limit.unit} per water meter per month (${THRESHOLD_KIND_LABELS[limit.kind]}; source: ${limit.source}).`,
        reason,
        'Missing or unit-mismatched readings are not treated as zero, so the row stays Not enough data.',
        ...utilities.methods,
      ],
      findingIds: findings.map((finding) => finding.id),
    }
  }

  const worst = [...checked].sort(
    (a, b) => b.latestKnownConsumption / limit.limit - a.latestKnownConsumption / limit.limit,
  )[0]
  const ratio = worst.latestKnownConsumption / limit.limit
  const status: NeedsCategoryStatus = ratio > 1 ? 'critical' : 'adequate'
  const usedPct = Math.round(ratio * 100)
  const missingNote =
    worst.missingReadings > 0
      ? `${worst.missingReadings} missing reading(s) on this meter are excluded; the latest known month may be older than the current month and the figure is a lower bound.`
      : 'No missing readings are recorded on this meter.'

  return {
    key: 'water',
    label: NEEDS_CATEGORY_LABELS.water,
    demand: `Latest month ${worst.latestKnownConsumption} ${limit.unit} vs limit ${limit.limit} ${limit.unit} (${usedPct}%)`,
    status,
    statusLabel: NEEDS_STATUS_LABELS[status],
    facts: emptyFacts,
    why: [
      `${worst.meter.label} records ${worst.latestKnownConsumption} ${limit.unit} in the latest known month (${formatDate(worst.latestKnownAt as string)}) against a limit of ${limit.limit} ${limit.unit} per month (${usedPct}% of the limit).`,
      `Limit type: ${THRESHOLD_KIND_LABELS[limit.kind]}; source: ${limit.source}. Recorded by ${limit.updatedByName} on ${formatDate(limit.updatedAt)}.`,
      `${missingNote} At or below the limit is Adequate; above it is Critical.`,
    ],
    method: [
      `A Water limit means the monthly consumption allowed for one water meter, in ${limit.unit}. The recorded limit is ${limit.limit} ${limit.unit} per meter per month (${THRESHOLD_KIND_LABELS[limit.kind]}; source: ${limit.source}).`,
      `${checked.length} water meter${checked.length === 1 ? '' : 's'} record a latest known month. The worst ratio decides the row: at or below the limit is Adequate, above it is Critical. No middle band or default limit is invented.`,
      `Worst meter: ${worst.meter.label}, ${worst.latestKnownConsumption} ${limit.unit} in ${formatDate(worst.latestKnownAt as string)} (${usedPct}% of the limit).`,
      `${missingNote} Missing readings are excluded, never treated as zero.`,
      ...utilities.methods,
    ],
    findingIds: findings.map((finding) => finding.id),
  }
}

function buildLighting(dataset: DatasetSources, findings: Finding[]): NeedsCategoryRow {
  const assets = dataset.urbanAssets.filter((asset) => asset.category === 'street_lighting')
  const assetIds = new Set(assets.map((asset) => asset.id))
  const linked = findings.filter((finding) => {
    const assetId = String(finding.facts?.assetId ?? '')
    return assetId ? assetIds.has(assetId) : false
  })

  return {
    key: 'lighting',
    label: NEEDS_CATEGORY_LABELS.lighting,
    demand:
      assets.length === 0
        ? 'Data missing'
        : `${assets.length} street-lighting asset${assets.length === 1 ? '' : 's'}; no fault counts recorded`,
    status: 'not_enough_data',
    statusLabel: NEEDS_STATUS_LABELS.not_enough_data,
    facts: { enrolled: null, seats: null, roomCode: null, present: null, averagePresent: null, decidingScore: null, sessionsUsed: 0, sessionsTotal: 0 },
    why:
      assets.length === 0
        ? [
            'No street-lighting assets are recorded.',
            'A status needs outage, condition or inspection counts; none exist, so it is Not enough data.',
          ]
        : [
            `${assets.length} shared street-lighting asset${assets.length === 1 ? ' is' : 's are'} recorded, but no fault, outage or inspection count is recorded.`,
            `A Stressed or Adequate status cannot be calculated from an asset name alone, so it is Not enough data.`,
          ],
    method: [
      'A lighting status would compare recorded faults or outages with the number of recorded lights.',
      'MicroCity has no such counts in this dataset, so no percentage and no threshold are calculated.',
      'No rule in this build takes a limit for Lighting, so no limit field is offered for it. A limit would not create outage records.',
    ],
    findingIds: linked.map((finding) => finding.id),
  }
}

function buildMissing(key: 'waste' | 'parking'): NeedsCategoryRow {
  const label = NEEDS_CATEGORY_LABELS[key]
  return {
    key,
    label,
    demand: 'Data missing',
    status: 'not_enough_data',
    statusLabel: NEEDS_STATUS_LABELS.not_enough_data,
    facts: { enrolled: null, seats: null, roomCode: null, present: null, averagePresent: null, decidingScore: null, sessionsUsed: 0, sessionsTotal: 0 },
    why: [
      `No ${label.toLowerCase()} capacity, demand or measurement records exist in MicroCity.`,
      'A status is not invented, so the category is Not enough data.',
    ],
    method: [
      `There is no recorded ${label.toLowerCase()} measurement to divide or compare.`,
      'The row stays Not enough data until a source records demand and capacity.',
      `No rule in this build takes a limit for ${label}, so no limit field is offered for it. A limit would not create measurement records.`,
    ],
    findingIds: [],
  }
}

export function buildNeedsCategories(
  dataset: DatasetSources,
  capacity: NeedsAnalysis,
  utilities: UtilitiesAnalysis,
  findings: Finding[],
  limits: NeedsLimitConfig[] = [],
): NeedsCategoryRow[] {
  return [
    buildRooms(capacity, findings),
    buildWater(dataset, utilities, limits),
    buildLighting(dataset, findings),
    buildMissing('waste'),
    buildMissing('parking'),
  ]
}
