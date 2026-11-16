import { useEffect, useState } from 'react'
import PageHeading from '../../components/dashboard/PageHeading'
import Panel from '../../components/ui/Panel'
import Tabs from '../../components/ui/Tabs'
import { Badge } from '../../components/ui/Badge'
import BasisTag from '../../components/ui/BasisTag'
import Notice from '../../components/ui/Notice'
import RecordDialog from '../../components/ui/RecordDialog'
import type { FormField } from '../../components/ui/RecordDialog'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { EmptyPanel } from '../../components/ui/PageState'
import { api } from '../../lib/api'
import { useAuth } from '../../auth/auth-context'
import { formatCurrency, formatDate, formatDateTime, formatNumber, percentage, titleCase } from '../../lib/format'
import { SPIKE_RULE } from '../../domain/analysis'
import type { MeterAnalysis, UtilityPeriod } from '../../domain/analysis'

type UtilityKey = 'electricity' | 'water'
type ManageTab = 'meters' | 'readings' | 'tariffs'

interface Editor {
  entity: string
  initial: Record<string, unknown> | null
  title: string
}

interface PendingDelete {
  entity: string
  id: string
  label: string
}

const thClass = 'whitespace-nowrap px-3 py-2 text-left font-mono text-[0.625rem] uppercase tracking-widest text-gold/80'
const tdClass = 'px-3 py-2.5 align-top text-sm text-ivory/75'
const rowActionClass = 'rounded border border-violet/40 px-2 py-1 font-mono text-[0.625rem] uppercase tracking-wider text-violet-bright hover:bg-violet/15 focus-ring'

function periodLabel(period: UtilityPeriod): string {
  return formatDate(period.at)
}

function monthLabel(at: string): string {
  return new Date(at).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  })
}

/** Small consumption chart: bars, missing periods visibly hollow, spikes gold. */
function ConsumptionChart({ meter }: { meter: MeterAnalysis }) {
  const periods = meter.periods.filter((period) => period.kind !== 'baseline').slice(-12)
  if (periods.length === 0) {
    return <p className="text-xs italic text-ivory/45">No consumption periods can be calculated from the recorded readings.</p>
  }
  const known = periods.filter((period) => period.consumption !== null)
  const max = Math.max(1, ...known.map((period) => period.consumption ?? 0), meter.baseline ?? 0)
  return (
    <div>
      <div className="relative flex h-40 items-end gap-1 border-b border-l border-ivory/15 pl-1">
        {meter.baseline !== null && (
          <div
            className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-violet-bright/50"
            style={{ bottom: `${Math.min(100, (meter.baseline / max) * 100)}%` }}
          >
            <span className="absolute right-0 -top-4 z-10 whitespace-nowrap bg-ink px-1 font-mono text-[0.5625rem] text-violet-bright/70">
              median {formatNumber(meter.baseline)} (prior periods)
            </span>
          </div>
        )}
        {periods.map((period) => {
          const missing = period.consumption === null
          const height = missing ? 8 : Math.max(3, ((period.consumption ?? 0) / max) * 100)
          const colour = missing
            ? 'border border-dashed border-ivory/30 bg-transparent'
            : period.isSpike
              ? 'bg-status-error-dark'
              : period.spanning
                ? 'bg-violet-bright/50'
                : 'bg-violet'
          return (
            <div key={period.readingId} className="group relative flex h-full flex-1 items-end">
              <div
                className={`w-full ${colour}`}
                style={{ height: `${height}%` }}
                title={`${periodLabel(period)}: ${
                  missing ? 'missing value' : `${formatNumber(period.consumption)} ${period.unit}${period.isSpike ? ' — flagged spike' : ''}${period.spanning ? ' — multi-period total' : ''}`
                }`}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[0.5625rem] text-ivory/40">
        <span>{periodLabel(periods[0])}</span>
        <span>{periodLabel(periods[periods.length - 1])}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[0.5625rem] uppercase tracking-wider text-ivory/40">
        <span className="flex items-center gap-1"><span className="h-2 w-2 bg-violet" aria-hidden="true" /> recorded</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 border border-dashed border-ivory/40" aria-hidden="true" /> missing</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 bg-status-error-dark" aria-hidden="true" /> flagged spike</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 bg-violet-bright/50" aria-hidden="true" /> spans missing period</span>
      </div>
    </div>
  )
}

export default function Resources() {
  const { workspace, analysis, refresh, can } = useAuth()
  const [utility, setUtility] = useState<UtilityKey>('electricity')
  const [chartMeterId, setChartMeterId] = useState<string | null>(null)
  const [manageTab, setManageTab] = useState<ManageTab>('meters')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [tariffDraft, setTariffDraft] = useState('')
  const [tariffError, setTariffError] = useState<string | null>(null)
  const [tariffSaved, setTariffSaved] = useState<string | null>(null)

  const canManage = can('manage-inventory')
  const data = workspace?.dataset

  const unitFor: Record<UtilityKey, string> = { electricity: 'kWh', water: 'm3' }
  const currentTariff = data
    ? [...data.tariffs]
        .filter((tariff) => tariff.utility === utility && tariff.unit === unitFor[utility])
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null
    : null

  useEffect(() => {
    setTariffDraft(currentTariff?.ratePerUnit !== null && currentTariff?.ratePerUnit !== undefined ? String(currentTariff.ratePerUnit) : '')
  }, [currentTariff?.id, currentTariff?.ratePerUnit])

  useEffect(() => {
    setChartMeterId(null)
    setTariffError(null)
    setTariffSaved(null)
  }, [utility])

  if (!workspace || !analysis) return null
  const dataset = workspace.dataset
  const meterAnalyses = analysis.utilities.meters.filter((entry) => entry.meter.utility === utility)
  const chartMeter = meterAnalyses.find((entry) => entry.meter.id === chartMeterId) ?? null

  const buildingOptions = dataset.buildings.map((building) => ({ value: building.id, label: building.name }))
  const meterOptions = dataset.utilityMeters.map((meter) => ({
    value: meter.id,
    label: `${meter.label} — ${meter.unit} (${titleCase(meter.readingType)})`,
  }))
  const meterById = new Map(dataset.utilityMeters.map((meter) => [meter.id, meter]))
  const buildingById = new Map(dataset.buildings.map((building) => [building.id, building]))

  const latestMissingReadingFor = (meterId: string) =>
    [...dataset.utilityReadings].filter((reading) => reading.meterId === meterId && reading.value === null).sort((a, b) => b.readAt.localeCompare(a.readAt))[0] ?? null

  const saveTariff = async () => {
    if (!canManage || !currentTariff) return
    const trimmed = tariffDraft.trim()
    const value = trimmed === '' ? null : Number(trimmed)
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setTariffError('Enter a rate of zero or more, or leave it blank.')
      return
    }
    setTariffError(null)
    setTariffSaved(null)
    try {
      await api.updateRecord('tariffs', currentTariff.id, { ratePerUnit: value })
      await refresh()
      setTariffSaved(value === null ? 'Tariff cleared. Costs remain unavailable until a rate is entered.' : 'Tariff saved. Cost figures are estimates from this rate, not a bill.')
    } catch (err) {
      setTariffError(err instanceof Error ? err.message : 'The tariff could not be saved.')
    }
  }

  const fieldsFor = (entity: string): FormField[] => {
    switch (entity) {
      case 'utilityMeters':
        return [
          { key: 'label', label: 'Meter label', type: 'text', required: true },
          { key: 'buildingId', label: 'Building', type: 'select', required: true, options: buildingOptions },
          { key: 'utility', label: 'Utility', type: 'select', required: true, options: [
            { value: 'electricity', label: 'Electricity' },
            { value: 'water', label: 'Water' },
          ] },
          { key: 'unit', label: 'Unit', type: 'select', required: true, options: [
            { value: 'kWh', label: 'kWh (electricity)' },
            { value: 'm3', label: 'm³ (water)' },
          ], help: 'Electricity meters must use kWh; water meters must use m³.' },
          { key: 'readingType', label: 'Reading type', type: 'select', required: true, options: [
            { value: 'interval', label: 'Interval — each value is period consumption' },
            { value: 'cumulative', label: 'Cumulative — each value is a meter register' },
          ] },
          { key: 'measurementType', label: 'Measurement type', type: 'select', options: [
            { value: 'measured', label: 'Measured — spike checks apply' },
            { value: 'estimated', label: 'Estimated — no spike check' },
          ], help: 'Estimated meters are never given a leak prompt: the estimation step could create or hide a spike.' },
        ]
      case 'utilityReadings':
        return [
          { key: 'meterId', label: 'Meter', type: 'select', required: true, options: meterOptions },
          { key: 'readAt', label: 'Read at', type: 'datetime', required: true },
          { key: 'value', label: 'Value', type: 'number', help: 'Leave empty for a missing reading. It is preserved as a gap, never zero.' },
          { key: 'unit', label: 'Unit', type: 'select', required: true, options: [
            { value: 'kWh', label: 'kWh' },
            { value: 'm3', label: 'm³' },
          ], help: 'Must match the meter unit.' },
          { key: 'note', label: 'Note', type: 'textarea' },
        ]
      case 'tariffs':
        return [
          { key: 'utility', label: 'Utility', type: 'select', required: true, options: [
            { value: 'electricity', label: 'Electricity' },
            { value: 'water', label: 'Water' },
          ] },
          { key: 'unit', label: 'Unit', type: 'select', required: true, options: [
            { value: 'kWh', label: 'kWh' },
            { value: 'm3', label: 'm³' },
          ] },
          { key: 'currency', label: 'Currency', type: 'text', required: true, placeholder: 'INR' },
          { key: 'ratePerUnit', label: 'Rate per unit', type: 'number' },
          { key: 'standingChargePerPeriod', label: 'Standing charge per period', type: 'number' },
          { key: 'effectiveFrom', label: 'Effective from', type: 'date', required: true },
          { key: 'note', label: 'Source note', type: 'textarea', help: 'Record the tariff source so estimates are not mistaken for supplied prices.' },
        ]
      default:
        return []
    }
  }

  const remove = async () => {
    if (!pendingDelete) return
    await api.deleteRecord(pendingDelete.entity, pendingDelete.id)
    await refresh()
  }

  const manageTabs = [
    { id: 'meters', label: 'Meters', count: dataset.utilityMeters.length },
    { id: 'readings', label: 'Readings', count: dataset.utilityReadings.length },
    { id: 'tariffs', label: 'Tariffs', count: dataset.tariffs.length },
  ]

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeading
          kicker="Module 03 — Resources"
          title="Resources"
          description="Electricity and water consumption from recorded meter readings. Missing readings stay missing, totals are lower bounds, and every spike prompt points back to its reading."
        />
        {canManage && (
          <button
            type="button"
            onClick={() => setEditor({ entity: 'utilityReadings', initial: null, title: 'Add reading' })}
            className="rounded-md bg-violet px-4 py-2.5 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring"
          >
            Add reading
          </button>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="inline-flex border border-violet/40" role="group" aria-label="Utility">
          {(['electricity', 'water'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={utility === value}
              onClick={() => setUtility(value)}
              className={`px-4 py-2 font-mono text-[0.6875rem] uppercase tracking-widest focus-ring ${
                utility === value ? 'bg-violet text-ivory' : 'text-ivory/60 hover:bg-violet/15'
              }`}
            >
              {value === 'electricity' ? 'Electricity' : 'Water'}
            </button>
          ))}
        </div>

        <label className="block text-xs text-ivory/60">
          Tariff, ₹ per unit
          <input
            inputMode="decimal"
            value={tariffDraft}
            disabled={!canManage || !currentTariff}
            onChange={(event) => setTariffDraft(event.target.value)}
            onBlur={() => void saveTariff()}
            placeholder={currentTariff ? 'Enter from your bill' : 'No tariff record'}
            className="mt-1 min-h-10 w-44 rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring disabled:opacity-60"
          />
          <span className="mt-1 block text-[0.625rem] text-ivory/40">
            {currentTariff
              ? `Per ${currentTariff.unit}. Recorded rate, not a supplier price. ${canManage ? 'Saves when you leave the field.' : 'Read-only for your role.'}`
              : 'No tariff record exists for this utility.'}
          </span>
        </label>
      </div>
      {tariffError && <Notice tone="danger" className="mb-4">{tariffError}</Notice>}
      {tariffSaved && <Notice tone="success" className="mb-4">{tariffSaved}</Notice>}

      {meterAnalyses.length === 0 ? (
        <Panel>
          <EmptyPanel title={`No ${utility} meters recorded`}>
            Add a meter to begin recording {utility} consumption.
          </EmptyPanel>
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {meterAnalyses.map((meter) => {
            const latestReading = latestMissingReadingFor(meter.meter.id)
            const missingLatest = latestReading?.value === null
            const costLabel =
              meter.estimatedCost === null
                ? 'Cost: enter your tariff'
                : `Cost: ${formatCurrency(meter.estimatedCost, meter.costCurrency)}${meter.costComplete ? '' : ' (partial)'}`
            const changeLabel =
              meter.changePct === null
                ? 'Latest month change not available.'
                : meter.changePct >= 0
                  ? `Latest month +${Math.round(meter.changePct * 100)}% vs normal.`
                  : `Latest month ${Math.round(meter.changePct * 100)}% vs normal.`
            return (
              <article key={meter.meter.id} className="flex flex-col border border-violet/30 bg-ink/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="font-heading text-lg text-ivory">{meter.meter.label}</h2>
                    <p className="mt-0.5 text-xs text-ivory/50">
                      {meter.buildingName} · {meter.meter.unit}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <BasisTag basis={meter.meter.basis} />
                    <Badge tone={meter.measurementType === 'estimated' ? 'neutral' : 'ok'}>
                      {meter.measurementType === 'estimated' ? 'Estimated' : 'Measured'}
                    </Badge>
                    {meter.missingReadings > 0 && <Badge tone="warn">Missing data</Badge>}
                    {meter.measurementType === 'measured' && meter.spikes.length > 0 && (
                      <Badge tone="error">Spike: check for leak</Badge>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <p className="font-mono text-2xl text-ivory">
                    {meter.latestKnownConsumption === null ? 'Not available' : `${formatNumber(meter.latestKnownConsumption)} ${meter.meter.unit}`}
                  </p>
                  <p className="mt-0.5 text-xs text-ivory/45">
                    Latest known month{meter.latestKnownAt ? ` · ${formatDate(meter.latestKnownAt)}` : ''}
                  </p>
                </div>
                {missingLatest ? (
                  <div className="mt-4 flex-1 border border-dashed border-gold/50 bg-gold/5 p-3">
                    <p className="text-sm leading-relaxed text-ivory/80">
                      No reading for {monthLabel(latestReading.readAt)}. Shown as missing, not as zero. Totals are lower
                      bounds.
                    </p>
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() =>
                          setEditor({
                            entity: 'utilityReadings',
                            initial: { meterId: meter.meter.id, unit: meter.meter.unit },
                            title: 'Add reading',
                          })
                        }
                        className="mt-3 rounded-md border border-violet/50 px-3 py-1.5 text-sm font-semibold text-violet-bright hover:bg-violet/15 focus-ring"
                      >
                        Add reading
                      </button>
                    ) : (
                      <p className="mt-2 text-xs text-ivory/45">A staff member with meter access must add the reading.</p>
                    )}
                  </div>
                ) : <div className="flex-1" />}

                <p className="mt-3 text-xs leading-relaxed text-ivory/55">
                  {meter.knownPeriods} known period{meter.knownPeriods === 1 ? '' : 's'}.
                  {' '}
                  {changeLabel}
                </p>
                <p className="mt-1 text-sm text-ivory/75">{costLabel}</p>
                {meter.measurementType === 'estimated' && (
                  <p className="mt-1 text-xs text-gold/90">Estimated, spike check not possible.</p>
                )}
                {meter.resets.length > 0 && (
                  <p className="mt-1 text-xs text-ivory/45">
                    {meter.resets.length} register reset(s); no negative consumption was produced.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setChartMeterId(meter.meter.id)}
                  className="mt-3 self-start text-sm font-semibold text-violet-bright underline underline-offset-4 hover:text-ivory focus-ring"
                >
                  View chart
                </button>
              </article>
            )
          })}
        </div>
      )}

      {chartMeter && (
        <Panel
          className="mt-6"
          kicker={`${titleCase(utility)} chart`}
          title={chartMeter.meter.label}
          actions={
            <button
              type="button"
              onClick={() => setChartMeterId(null)}
              className="font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright hover:text-ivory focus-ring"
            >
              Close chart
            </button>
          }
        >
          <ConsumptionChart meter={chartMeter} />
          {chartMeter.spikes.length > 0 && chartMeter.measurementType === 'measured' && (
            <ul className="mt-4 space-y-1.5 border-t border-violet/15 pt-3 text-xs leading-relaxed text-ivory/65">
              {chartMeter.spikes.map((spike) => (
                <li key={spike.readingId}>
                  <span className="font-semibold text-status-error-dark">Spike</span> — {formatNumber(spike.consumption)}{' '}
                  {chartMeter.meter.unit} at {formatDate(spike.at)}; median {formatNumber(spike.baseline)},{' '}
                  {percentage(spike.deviationPct, 0)} above. Investigate; the cause is not recorded.
                </li>
              ))}
            </ul>
          )}
          <details className="mt-4 border-t border-violet/15 pt-3">
            <summary className="cursor-pointer font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright">
              How are spikes found?
            </summary>
            <ul className="mt-2 space-y-2 text-xs leading-relaxed text-ivory/55">
              <li>• At least {SPIKE_RULE.minimumPeriods} usable periods are required.</li>
              <li>
                • A measured value is flagged when its robust z-score exceeds {SPIKE_RULE.robustZ} and it is at least{' '}
                {Math.round(SPIKE_RULE.minimumRelativeExcess * 100)}% above the series median.
              </li>
              <li>• On a flat series a value at least {SPIKE_RULE.flatSeriesMultiple}× the median is flagged.</li>
              <li>• Missing readings stay missing, never zero. A falling meter register is a reset, not negative consumption.</li>
              <li>• Differences spanning a missing reading or more than {SPIKE_RULE.gapDays} days cover multiple periods and are excluded from spike checks.</li>
              <li>• Estimated meters are never given a spike flag: the estimation step could create or hide one.</li>
              <li>• A flag is a prompt to investigate, not a diagnosis.</li>
            </ul>
          </details>
        </Panel>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel kicker="Reading rules" title="Missing is never zero">
          <ul className="space-y-2 text-sm leading-relaxed text-ivory/70">
            <li>• Missing readings are excluded, never replaced or counted as zero, so totals are lower bounds.</li>
            <li>• A falling cumulative register is a reset; no negative consumption is produced.</li>
            <li>• A difference spanning a missing reading or more than {SPIKE_RULE.gapDays} days is a multi-period total and is excluded from trend and spike tests.</li>
            <li>• Costs use the recorded tariff and are estimates, not supplier invoices.</li>
          </ul>
        </Panel>
        <Panel kicker="Meter types" title="Measured and Estimated">
          <ul className="space-y-2 text-sm leading-relaxed text-ivory/70">
            <li>• <strong className="text-ivory">Measured</strong> meters are tested for unusual values and can show a leak-investigation prompt.</li>
            <li>• <strong className="text-ivory">Estimated</strong> meters still report consumption and cost, but no spike check is possible.</li>
            <li>• <strong className="text-ivory">Missing data</strong> marks a meter with at least one reading that was not submitted.</li>
            <li>• Measurement type is recorded per meter; older records without it are treated as Measured.</li>
          </ul>
          <Notice tone="info" className="mt-3">
            All readings are calculated on the server from recorded values. No AI creates or changes a reading.
          </Notice>
        </Panel>
      </div>

      <Panel className="mt-8" kicker="Records" title="Meters, readings and tariffs">
        <Tabs
          tabs={manageTabs}
          active={manageTab}
          onChange={(id) => setManageTab(id as ManageTab)}
          label="Resource records"
        />
        <div className="mt-4 flex justify-end">
          {canManage && (
            <button
              type="button"
              onClick={() =>
                setEditor({
                  entity: manageTab === 'meters' ? 'utilityMeters' : manageTab === 'readings' ? 'utilityReadings' : 'tariffs',
                  initial: null,
                  title: manageTab === 'meters' ? 'Add meter' : manageTab === 'readings' ? 'Add reading' : 'Add tariff',
                })
              }
              className="rounded-md bg-violet px-3.5 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring"
            >
              {manageTab === 'meters' ? 'Add meter' : manageTab === 'readings' ? 'Add reading' : 'Add tariff'}
            </button>
          )}
        </div>

        <div className="mt-4">
          {manageTab === 'meters' && (
            dataset.utilityMeters.length === 0 ? (
              <EmptyPanel title="No meters recorded">Add electricity and water meters for each building.</EmptyPanel>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse">
                  <thead><tr className="border-b border-violet/30">
                    <th className={thClass}>Meter</th><th className={thClass}>Building</th><th className={thClass}>Utility</th><th className={thClass}>Unit</th><th className={thClass}>Reading type</th><th className={thClass}>Measurement</th><th className={thClass}>Basis</th><th className={thClass}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {dataset.utilityMeters.map((meter) => (
                      <tr key={meter.id} className="border-b border-violet/15 last:border-0">
                        <td className={tdClass}><span className="text-ivory">{meter.label}</span><span className="mt-0.5 block font-mono text-[0.625rem] text-ivory/35">{meter.id}</span></td>
                        <td className={tdClass}>{buildingById.get(meter.buildingId)?.name ?? '—'}</td>
                        <td className={tdClass}>{titleCase(meter.utility)}</td>
                        <td className={tdClass}>{meter.unit}</td>
                        <td className={tdClass}>{titleCase(meter.readingType)}</td>
                        <td className={tdClass}>{meter.measurementType === 'estimated' ? 'Estimated' : 'Measured'}</td>
                        <td className={tdClass}><BasisTag basis={meter.basis} /></td>
                        <td className={tdClass}>
                          {canManage && (
                            <div className="flex gap-2">
                              <button type="button" className={rowActionClass} onClick={() => setEditor({ entity: 'utilityMeters', initial: meter as unknown as Record<string, unknown>, title: 'Edit meter' })}>Edit</button>
                              <button type="button" className={rowActionClass} onClick={() => setPendingDelete({ entity: 'utilityMeters', id: meter.id, label: meter.label })}>Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {manageTab === 'readings' && (
            dataset.utilityReadings.length === 0 ? (
              <EmptyPanel title="No readings recorded">Add readings to compute consumption. Empty values are kept as gaps.</EmptyPanel>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse">
                  <thead><tr className="border-b border-violet/30">
                    <th className={thClass}>Meter</th><th className={thClass}>Read at</th><th className={thClass}>Value</th><th className={thClass}>Unit</th><th className={thClass}>Note</th><th className={thClass}>Basis</th><th className={thClass}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {[...dataset.utilityReadings].sort((a, b) => b.readAt.localeCompare(a.readAt)).map((reading) => (
                      <tr key={reading.id} className="border-b border-violet/15 last:border-0">
                        <td className={tdClass}>{meterById.get(reading.meterId)?.label ?? '—'}</td>
                        <td className={tdClass}>{formatDateTime(reading.readAt)}</td>
                        <td className={tdClass}>
                          {reading.value === null ? (
                            <span className="inline-flex items-center gap-1 border border-dashed border-ivory/30 px-2 py-0.5 font-mono text-[0.625rem] uppercase text-ivory/50">
                              Missing value
                            </span>
                          ) : (
                            <span className="font-mono text-ivory">{formatNumber(reading.value)}</span>
                          )}
                        </td>
                        <td className={tdClass}>{reading.unit}</td>
                        <td className={`${tdClass} max-w-xs`}>{reading.note ?? '—'}</td>
                        <td className={tdClass}><BasisTag basis={reading.basis} /></td>
                        <td className={tdClass}>
                          {canManage && (
                            <div className="flex gap-2">
                              <button type="button" className={rowActionClass} onClick={() => setEditor({ entity: 'utilityReadings', initial: reading as unknown as Record<string, unknown>, title: 'Edit reading' })}>Edit</button>
                              <button type="button" className={rowActionClass} onClick={() => setPendingDelete({ entity: 'utilityReadings', id: reading.id, label: `${meterById.get(reading.meterId)?.label ?? 'meter'} reading on ${formatDate(reading.readAt)}` })}>Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {manageTab === 'tariffs' && (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-ivory/60">
                A tariff matches by utility, unit and effective date. The latest tariff that starts on or before a
                reading is used; standing charges are shown but not allocated to individual periods. Seeded tariffs are
                blank placeholders: enter the rate and standing charge from your own bill. MicroCity does not supply or
                verify prices.
              </p>
              {dataset.tariffs.length === 0 ? (
                <EmptyPanel title="No tariffs configured">Cost estimates stay unavailable until a tariff is recorded.</EmptyPanel>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse">
                    <thead><tr className="border-b border-violet/30">
                      <th className={thClass}>Utility</th><th className={thClass}>Unit</th><th className={thClass}>Rate</th><th className={thClass}>Standing charge</th><th className={thClass}>Currency</th><th className={thClass}>Effective from</th><th className={thClass}>Note</th><th className={thClass}>Actions</th>
                    </tr></thead>
                    <tbody>
                      {dataset.tariffs.map((tariff) => (
                        <tr key={tariff.id} className="border-b border-violet/15 last:border-0">
                          <td className={tdClass}>{titleCase(tariff.utility)}</td>
                          <td className={tdClass}>{tariff.unit}</td>
                          <td className={tdClass}>
                            {tariff.ratePerUnit === null ? (
                              <span className="font-semibold text-gold">Enter from your bill</span>
                            ) : (
                              formatCurrency(tariff.ratePerUnit, tariff.currency)
                            )}
                          </td>
                          <td className={tdClass}>
                            {tariff.standingChargePerPeriod === null
                              ? tariff.ratePerUnit === null
                                ? 'Enter from your bill'
                                : '—'
                              : formatCurrency(tariff.standingChargePerPeriod, tariff.currency)}
                          </td>
                          <td className={tdClass}>{tariff.currency}</td>
                          <td className={tdClass}>{formatDate(tariff.effectiveFrom)}</td>
                          <td className={`${tdClass} max-w-xs`}>{tariff.note ?? '—'}</td>
                          <td className={tdClass}>
                            {canManage && (
                              <div className="flex gap-2">
                                <button type="button" className={rowActionClass} onClick={() => setEditor({ entity: 'tariffs', initial: tariff as unknown as Record<string, unknown>, title: 'Edit tariff' })}>Edit</button>
                                <button type="button" className={rowActionClass} onClick={() => setPendingDelete({ entity: 'tariffs', id: tariff.id, label: `${tariff.utility} tariff from ${formatDate(tariff.effectiveFrom)}` })}>Delete</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </Panel>

      {editor && (
        <RecordDialog
          open
          onClose={() => setEditor(null)}
          entity={editor.entity}
          title={editor.title}
          description="Every value traces to a recorded reading or tariff."
          fields={fieldsFor(editor.entity)}
          initial={editor.initial}
          onSaved={refresh}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this record?"
        message={pendingDelete ? `“${pendingDelete.label}” will be removed. This cannot be undone.` : ''}
        onConfirm={remove}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
