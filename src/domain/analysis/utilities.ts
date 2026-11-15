/**
 * Electricity and water consumption analysis.
 *
 * Interval meters record consumption per period. Cumulative meters record a
 * register; consumption is the difference between non-missing registers.
 * Missing readings stay missing (never zero), a falling register is treated as
 * a reset (no negative consumption), and a difference that spans a missing
 * reading is reported as a multi-period total rather than a monthly figure.
 *
 * Cost is only estimated when a configured tariff matches the utility, unit
 * and reading date. Standing charges are reported but not allocated to
 * readings. Spike detection is a documented robust median/MAD rule; it flags
 * values worth investigating and never claims a cause.
 */
import type { Building, Tariff, UtilityMeter, UtilityReading } from '../types.ts'
import type { Finding } from './types.ts'
import { zonedParts } from '../../lib/time.ts'

export const SPIKE_RULE = {
  minimumPeriods: 5,
  robustZ: 3.5,
  minimumRelativeExcess: 0.25,
  flatSeriesMultiple: 1.5,
  gapDays: 45,
} as const

export type ConsumptionKind =
  | 'interval'
  | 'cumulative-delta'
  | 'spans-missing'
  | 'baseline'
  | 'missing'
  | 'reset'

export interface UtilityPeriod {
  readingId: string
  at: string
  previousAt: string | null
  kind: ConsumptionKind
  consumption: number | null
  unit: string
  spanDays: number | null
  spanning: boolean
  /** True when consumption is a meter difference that covers more than one expected period. */
  isSpike: boolean
  baseline: number | null
  deviationPct: number | null
  cost: number | null
  currency: string | null
  tariffId: string | null
  note: string | null
}

export interface UtilitySpike {
  meterId: string
  readingId: string
  at: string
  consumption: number
  baseline: number
  deviationPct: number
  robustZ: number | null
}

export interface UtilityGap {
  meterId: string
  readingId: string
  at: string
  kind: 'missing-value' | 'unexpected-spacing'
  days: number | null
  detail: string
}

export interface UtilityReset {
  meterId: string
  readingId: string
  at: string
  previousValue: number
  value: number
}

export interface MeterAnalysis {
  meter: UtilityMeter
  buildingName: string
  /** Estimated meters cannot support a leak prompt; their values are still reported. */
  measurementType: 'measured' | 'estimated'
  periods: UtilityPeriod[]
  knownConsumption: number
  knownPeriods: number
  missingReadings: number
  latestKnownConsumption: number | null
  latestKnownAt: string | null
  baseline: number | null
  changePct: number | null
  estimatedCost: number | null
  costCurrency: string | null
  costComplete: boolean
  periodsWithoutTariff: number
  gaps: UtilityGap[]
  resets: UtilityReset[]
  spikes: UtilitySpike[]
  quality: 'ok' | 'limited' | 'insufficient'
}

export interface UtilityTotal {
  consumption: number | null
  unit: string
  cost: number | null
  currency: string | null
  costComplete: boolean
  meters: number
  missingReadings: number
}

export interface UtilitiesAnalysis {
  meters: MeterAnalysis[]
  totals: { electricity: UtilityTotal; water: UtilityTotal }
  readingCount: number
  missingCount: number
  spikeCount: number
  resetCount: number
  findings: Finding[]
  methods: string[]
}

const METHODS = [
  'Interval meters: each recorded value is the consumption for the recorded period. A null value is a missing period; adjacent periods are never used to invent a replacement value.',
  'Cumulative meters: consumption is the difference between consecutive non-missing register values. A lower register is treated as a reset and no negative consumption is produced.',
  `If a cumulative difference spans a missing reading or more than ${SPIKE_RULE.gapDays} days, the total is reported as a multi-period figure and excluded from monthly trends and spike tests.`,
  `Spike rule: at least ${SPIKE_RULE.minimumPeriods} usable periods are required. A value is flagged when its robust z-score exceeds ${SPIKE_RULE.robustZ} and it is at least ${Math.round(SPIKE_RULE.minimumRelativeExcess * 100)}% above the series median; when the median absolute deviation is zero, a value at least ${SPIKE_RULE.flatSeriesMultiple} times the median is flagged.`,
  'A flagged spike is a statistical prompt to investigate, not a diagnosis. Weather, occupancy, equipment changes and meter faults are not in the readings.',
  'Cost is estimated only for periods with recorded consumption and a tariff matching the utility, unit and effective date. Standing charges are shown but not allocated to individual readings. Estimates are not supplier invoices.',
  'Missing readings are excluded from totals; totals are therefore lower bounds for the full calendar period.',
  'Measured meters are tested for unusual values. Estimated meters are shown as Estimated: the estimation step could itself create or hide a spike, so no leak prompt is produced for them.',
]

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function medianAbsoluteDeviation(values: number[], centre: number): number {
  return median(values.map((value) => Math.abs(value - centre))) ?? 0
}

function daysBetween(from: string, to: string): number | null {
  const start = Date.parse(from)
  const end = Date.parse(to)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return Math.round((end - start) / 86_400_000)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function monthLabel(at: string): string {
  const parts = zonedParts(at)
  if (!parts) return at
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[Number(parts.month) - 1]} ${parts.year}`
}

function applicableTariff(tariffs: Tariff[], meter: UtilityMeter, at: string): Tariff | null {
  const time = Date.parse(at)
  if (Number.isNaN(time)) return null
  const candidates = tariffs
    .filter((tariff) => tariff.utility === meter.utility && tariff.unit === meter.unit)
    .filter((tariff) => {
      const from = Date.parse(tariff.effectiveFrom)
      return !Number.isNaN(from) && from <= time
    })
    .sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom))
  return candidates[0] ?? null
}

interface RawPeriod {
  readingId: string
  at: string
  previousAt: string | null
  kind: ConsumptionKind
  consumption: number | null
  unit: string
  spanDays: number | null
  spanning: boolean
  note: string | null
}

function buildPeriods(meter: UtilityMeter, readings: UtilityReading[]): { periods: RawPeriod[]; resets: UtilityReset[] } {
  const ordered = [...readings].sort((a, b) => Date.parse(a.readAt) - Date.parse(b.readAt))
  const periods: RawPeriod[] = []
  const resets: UtilityReset[] = []
  let lastKnown: { value: number; at: string } | null = null
  let missingSinceLastKnown = false
  let previousAt: string | null = null

  for (const reading of ordered) {
    const spanDays = previousAt ? daysBetween(previousAt, reading.readAt) : null
    const value = reading.value

    if (meter.readingType === 'interval') {
      periods.push({
        readingId: reading.id,
        at: reading.readAt,
        previousAt,
        kind: value === null ? 'missing' : 'interval',
        consumption: value,
        unit: reading.unit,
        spanDays,
        spanning: false,
        note: reading.note,
      })
      if (value === null) missingSinceLastKnown = true
      previousAt = reading.readAt
      continue
    }

    if (value === null) {
      periods.push({
        readingId: reading.id,
        at: reading.readAt,
        previousAt,
        kind: 'missing',
        consumption: null,
        unit: reading.unit,
        spanDays,
        spanning: false,
        note: reading.note,
      })
      missingSinceLastKnown = true
      previousAt = reading.readAt
      continue
    }

    if (!lastKnown) {
      periods.push({
        readingId: reading.id,
        at: reading.readAt,
        previousAt: null,
        kind: 'baseline',
        consumption: null,
        unit: reading.unit,
        spanDays: null,
        spanning: false,
        note: reading.note,
      })
      lastKnown = { value, at: reading.readAt }
      previousAt = reading.readAt
      continue
    }

    if (value < lastKnown.value) {
      resets.push({
        meterId: meter.id,
        readingId: reading.id,
        at: reading.readAt,
        previousValue: lastKnown.value,
        value,
      })
      periods.push({
        readingId: reading.id,
        at: reading.readAt,
        previousAt: lastKnown.at,
        kind: 'reset',
        consumption: null,
        unit: reading.unit,
        spanDays,
        spanning: false,
        note: reading.note,
      })
      lastKnown = { value, at: reading.readAt }
      missingSinceLastKnown = false
      previousAt = reading.readAt
      continue
    }

    const consumption = value - lastKnown.value
    const spanning = missingSinceLastKnown || (spanDays !== null && spanDays > SPIKE_RULE.gapDays)
    periods.push({
      readingId: reading.id,
      at: reading.readAt,
      previousAt: lastKnown.at,
      kind: spanning ? 'spans-missing' : 'cumulative-delta',
      consumption,
      unit: reading.unit,
      spanDays,
      spanning,
      note: reading.note,
    })
    lastKnown = { value, at: reading.readAt }
    missingSinceLastKnown = false
    previousAt = reading.readAt
  }

  return { periods, resets }
}

function collectGaps(meter: UtilityMeter, readings: UtilityReading[]): UtilityGap[] {
  const ordered = [...readings].sort((a, b) => Date.parse(a.readAt) - Date.parse(b.readAt))
  const gaps: UtilityGap[] = []
  for (let index = 0; index < ordered.length; index += 1) {
    const reading = ordered[index]
    if (reading.value === null) {
      gaps.push({
        meterId: meter.id,
        readingId: reading.id,
        at: reading.readAt,
        kind: 'missing-value',
        days: null,
        detail: `No value recorded for ${monthLabel(reading.readAt)}${reading.note ? ` (${reading.note})` : ''}. No replacement was estimated.`,
      })
      continue
    }
    const previous = ordered[index - 1]
    if (!previous || previous.value === null) continue
    const days = daysBetween(previous.readAt, reading.readAt)
    if (days !== null && days > SPIKE_RULE.gapDays) {
      gaps.push({
        meterId: meter.id,
        readingId: reading.id,
        at: reading.readAt,
        kind: 'unexpected-spacing',
        days,
        detail: `Readings are ${days} days apart (expected about a month). The consumption difference covers an unusually long period.`,
      })
    }
  }
  return gaps
}

export function analyseUtilities(
  meters: UtilityMeter[],
  readings: UtilityReading[],
  tariffs: Tariff[],
  buildings: Building[],
): UtilitiesAnalysis {
  const buildingName = new Map(buildings.map((building) => [building.id, building.name]))
  const meterAnalyses: MeterAnalysis[] = []
  const findings: Finding[] = []

  for (const meter of meters) {
    const measurementType = meter.measurementType === 'estimated' ? 'estimated' : 'measured'
    const meterReadings = readings.filter((reading) => reading.meterId === meter.id)
    const { periods: rawPeriods, resets } = buildPeriods(meter, meterReadings)
    const gaps = collectGaps(meter, meterReadings)

    const eligible = rawPeriods.filter(
      (period) => period.consumption !== null && (period.kind === 'interval' || period.kind === 'cumulative-delta'),
    )
    const values = eligible.map((period) => period.consumption as number)
    const seriesMedian = median(values)
    const mad = seriesMedian === null ? 0 : medianAbsoluteDeviation(values, seriesMedian)
    const spikes: UtilitySpike[] = []

    const periods: UtilityPeriod[] = rawPeriods.map((period) => {
      const tariff = period.consumption === null ? null : applicableTariff(tariffs, meter, period.at)
      const cost =
        period.consumption !== null && tariff && tariff.ratePerUnit !== null
          ? round2(period.consumption * tariff.ratePerUnit)
          : null
      let isSpike = false
      let deviationPct: number | null = null
      let robustZ: number | null = null

      if (
        period.consumption !== null &&
        seriesMedian !== null &&
        seriesMedian > 0 &&
        (period.kind === 'interval' || period.kind === 'cumulative-delta')
      ) {
        const excess = period.consumption - seriesMedian
        deviationPct = excess / seriesMedian
        robustZ = mad > 0 ? (0.6745 * excess) / mad : null
        isSpike =
          measurementType === 'measured' &&
          values.length >= SPIKE_RULE.minimumPeriods &&
          (mad > 0
            ? robustZ !== null && robustZ >= SPIKE_RULE.robustZ && deviationPct >= SPIKE_RULE.minimumRelativeExcess
            : period.consumption >= seriesMedian * SPIKE_RULE.flatSeriesMultiple)
        if (isSpike) {
          spikes.push({
            meterId: meter.id,
            readingId: period.readingId,
            at: period.at,
            consumption: period.consumption,
            baseline: seriesMedian,
            deviationPct,
            robustZ,
          })
        }
      }

      return {
        readingId: period.readingId,
        at: period.at,
        previousAt: period.previousAt,
        kind: period.kind,
        consumption: period.consumption,
        unit: period.unit,
        spanDays: period.spanDays,
        spanning: period.spanning,
        isSpike,
        baseline: seriesMedian,
        deviationPct,
        cost,
        currency: tariff?.currency ?? null,
        tariffId: tariff?.id ?? null,
        note: period.note,
      }
    })

    const withConsumption = periods.filter((period) => period.consumption !== null)
    const totalConsumption = withConsumption.reduce((sum, period) => sum + (period.consumption as number), 0)
    const latest = withConsumption[withConsumption.length - 1] ?? null
    const priorValues = withConsumption
      .slice(0, -1)
      .map((period) => period.consumption as number)
    const priorBaseline = median(priorValues)
    const changePct =
      latest && priorBaseline !== null && priorBaseline > 0
        ? (latest.consumption as number) / priorBaseline - 1
        : null

    const costs = periods.filter((period) => period.cost !== null)
    const currencies = new Set(costs.map((period) => period.currency).filter((value): value is string => Boolean(value)))
    const singleCurrency = currencies.size === 1
    const periodsWithoutTariff = withConsumption.filter((period) => period.cost === null).length
    const costComplete = singleCurrency && periodsWithoutTariff === 0

    const knownPeriods = withConsumption.length
    const missingReadings = periods.filter((period) => period.kind === 'missing').length
    const quality: MeterAnalysis['quality'] =
      knownPeriods >= 6 && missingReadings === 0 && resets.length === 0
        ? 'ok'
        : knownPeriods >= 3
          ? 'limited'
          : 'insufficient'

    const analysis: MeterAnalysis = {
      meter,
      buildingName: buildingName.get(meter.buildingId) ?? 'Unknown building',
      measurementType,
      periods,
      knownConsumption: round2(totalConsumption),
      knownPeriods,
      missingReadings,
      latestKnownConsumption: latest ? latest.consumption : null,
      latestKnownAt: latest ? latest.at : null,
      baseline: priorBaseline,
      changePct,
      estimatedCost: singleCurrency ? round2(costs.reduce((sum, period) => sum + (period.cost as number), 0)) : null,
      costCurrency: singleCurrency ? [...currencies][0] : null,
      costComplete,
      periodsWithoutTariff,
      gaps,
      resets,
      spikes,
      quality,
    }
    meterAnalyses.push(analysis)

    for (const spike of spikes) {
      const severity = spike.deviationPct >= 1 || (spike.robustZ !== null && spike.robustZ >= 6) ? 'high' : 'medium'
      const periodCost = periods.find((period) => period.readingId === spike.readingId)?.cost ?? null
      findings.push({
        id: `utility-spike-${spike.readingId}`,
        module: 'utilities',
        severity,
        title: `${meter.utility === 'electricity' ? 'Electricity' : 'Water'} consumption spike: ${meter.label} (${monthLabel(spike.at)})`,
        summary:
          `Recorded consumption is ${spike.consumption.toLocaleString('en-IN')} ${meter.unit}, ` +
          `${Math.round(spike.deviationPct * 100)}% above the series median of ${spike.baseline.toLocaleString('en-IN')} ${meter.unit}. ` +
          'This is a statistical flag for investigation, not a diagnosed cause.',
        evidence: [
          `${monthLabel(spike.at)}: ${spike.consumption.toLocaleString('en-IN')} ${meter.unit}`,
          `Series median: ${spike.baseline.toLocaleString('en-IN')} ${meter.unit} from ${values.length} usable periods`,
          spike.robustZ !== null ? `Robust z-score: ${spike.robustZ.toFixed(2)} (threshold ${SPIKE_RULE.robustZ})` : 'Median absolute deviation was zero; flat-series multiple rule applied.',
          periodCost !== null
            ? `Estimated variable cost at the recorded tariff: ${analysis.costCurrency ?? ''} ${periodCost.toFixed(2)} (estimate, not an invoice).`
            : 'No tariff rate was recorded for this period.',
        ],
        limitations: [
          'Weather, occupancy, equipment changes and meter faults are not recorded in the reading.',
          'The spike rule identifies unusual values only; it cannot establish a leak or fault.',
          'The demonstration workspace is synthetic.',
        ],
        subjectIds: [meter.id, spike.readingId],
        facts: {
          meterId: meter.id,
          meterLabel: meter.label,
          building: analysis.buildingName,
          utility: meter.utility,
          readingAt: spike.at,
          consumption: spike.consumption,
          unit: meter.unit,
          seriesMedian: spike.baseline,
          deviationPct: round2(spike.deviationPct * 100),
          robustZ: spike.robustZ,
          estimatedPeriodCost: periodCost,
          currency: analysis.costCurrency,
          useReadingRuleCount: values.length,
        },
      })
    }

    for (const gap of gaps) {
      findings.push({
        id: `utility-gap-${gap.readingId}${gap.kind === 'unexpected-spacing' ? '-spacing' : ''}`,
        module: 'utilities',
        severity: 'medium',
        title:
          gap.kind === 'missing-value'
            ? `Missing ${meter.utility} reading: ${meter.label} (${monthLabel(gap.at)})`
            : `Readings unusually far apart: ${meter.label} (${monthLabel(gap.at)})`,
        summary: gap.detail,
        evidence: [
          gap.detail,
          missingReadings > 0 ? `${missingReadings} missing reading(s) on this meter.` : 'No null readings recorded.',
          'Totals exclude missing periods and are lower bounds for the record.',
        ],
        limitations: [
          'No replacement value has been estimated.',
          'The cause of the missing reading is not in the records.',
        ],
        subjectIds: [meter.id, gap.readingId],
        facts: {
          meterId: meter.id,
          meterLabel: meter.label,
          utility: meter.utility,
          at: gap.at,
          gapKind: gap.kind,
          gapDays: gap.days,
          missingReadings,
        },
      })
    }

    for (const reset of resets) {
      findings.push({
        id: `utility-reset-${reset.readingId}`,
        module: 'utilities',
        severity: 'low',
        title: `Meter register reset: ${meter.label} (${monthLabel(reset.at)})`,
        summary:
          `The register fell from ${reset.previousValue.toLocaleString('en-IN')} to ${reset.value.toLocaleString('en-IN')} ${meter.unit}. ` +
          'No consumption was calculated for the reset period, so no negative value entered the totals.',
        evidence: [
          `Previous register: ${reset.previousValue.toLocaleString('en-IN')} ${meter.unit}`,
          `New register: ${reset.value.toLocaleString('en-IN')} ${meter.unit}`,
          `Recorded note: ${periods.find((period) => period.readingId === reset.readingId)?.note ?? 'none'}`,
        ],
        limitations: [
          'A replacement or rollover is not confirmed by the reading itself; the cause should be verified with the meter owner.',
          'Consumption for the reset interval is unavailable.',
        ],
        subjectIds: [meter.id, reset.readingId],
        facts: {
          meterId: meter.id,
          meterLabel: meter.label,
          at: reset.at,
          previousRegister: reset.previousValue,
          newRegister: reset.value,
          unit: meter.unit,
        },
      })
    }

    if (knownPeriods > 0 && knownPeriods < 6) {
      findings.push({
        id: `utility-${meter.id}`,
        module: 'utilities',
        severity: 'info',
        title: `Limited consumption baseline: ${meter.label}`,
        summary:
          `Only ${knownPeriods} usable period${knownPeriods === 1 ? '' : 's'} are recorded, so trend and spike statements are provisional. ` +
          'Circuit-level or sub-meter evidence is not available in this workspace.',
        evidence: [
          `${knownPeriods} usable periods`,
          `${missingReadings} missing reading(s), ${resets.length} reset(s)`,
          `Latest known reading: ${latest ? `${monthLabel(latest.at)} (${(latest.consumption as number).toLocaleString('en-IN')} ${meter.unit})` : 'none'}`,
        ],
        limitations: [
          'A short series cannot establish a reliable baseline.',
          'No estimate has been added for missing periods.',
        ],
        subjectIds: [meter.id],
        facts: {
          meterId: meter.id,
          meterLabel: meter.label,
          utility: meter.utility,
          knownPeriods,
          missingReadings,
          resets: resets.length,
        },
      })
    }

    if (knownPeriods > 0 && costs.length === 0) {
      findings.push({
        id: `utility-cost-${meter.id}`,
        module: 'utilities',
        severity: 'info',
        title: `No usable tariff rate: ${meter.label}`,
        summary:
          'Consumption is recorded but no tariff with an entered rate matches this meter utility, unit and reading dates, so no cost is estimated.',
        evidence: [
          `${knownPeriods} consumption period(s)`,
          `${tariffs.filter((tariff) => tariff.utility === meter.utility && tariff.unit === meter.unit).length} matching tariff record(s) in total`,
          `${tariffs.filter((tariff) => tariff.utility === meter.utility && tariff.unit === meter.unit && tariff.ratePerUnit !== null).length} with a rate entered`,
        ],
        limitations: [
          'MicroCity does not invent prices. Enter the rate from your bill to enable cost estimates.',
        ],
        subjectIds: [meter.id],
        facts: { meterId: meter.id, utility: meter.utility, unit: meter.unit, knownPeriods },
      })
    }
  }

  const totalFor = (utility: UtilityMeter['utility'], unit: string): UtilityTotal => {
    const matching = meterAnalyses.filter((analysis) => analysis.meter.utility === utility)
    const meterCount = matching.length
    const knownConsumption = matching.reduce((sum, analysis) => sum + analysis.knownConsumption, 0)
    const costs = matching.map((analysis) => analysis.estimatedCost)
    const currencies = new Set(matching.map((analysis) => analysis.costCurrency).filter((value): value is string => Boolean(value)))
    const costKnown = costs.every((value) => value !== null)
    return {
      consumption: meterCount === 0 ? null : round2(knownConsumption),
      unit,
      cost: currencies.size === 1 && costKnown ? round2(costs.reduce((sum, value) => sum + (value as number), 0)) : null,
      currency: currencies.size === 1 ? [...currencies][0] : null,
      costComplete: costKnown && matching.every((analysis) => analysis.costComplete),
      meters: meterCount,
      missingReadings: matching.reduce((sum, analysis) => sum + analysis.missingReadings, 0),
    }
  }

  const totals = {
    electricity: totalFor('electricity', 'kWh'),
    water: totalFor('water', 'm3'),
  }

  return {
    meters: meterAnalyses,
    totals,
    readingCount: meterAnalyses.reduce((sum, analysis) => sum + analysis.periods.length, 0),
    missingCount: meterAnalyses.reduce((sum, analysis) => sum + analysis.missingReadings, 0),
    spikeCount: meterAnalyses.reduce((sum, analysis) => sum + analysis.spikes.length, 0),
    resetCount: meterAnalyses.reduce((sum, analysis) => sum + analysis.resets.length, 0),
    findings,
    methods: METHODS,
  }
}
