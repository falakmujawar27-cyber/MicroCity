import { useState } from 'react'
import PageHeading from '../../components/dashboard/PageHeading'
import Panel from '../../components/ui/Panel'
import Tabs from '../../components/ui/Tabs'
import Stat from '../../components/ui/Stat'
import { Badge } from '../../components/ui/Badge'
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

type TabId = 'overview' | 'meters' | 'readings' | 'tariffs'

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
      <div className="relative flex h-32 items-end gap-1 border-b border-l border-ivory/15 pl-1">
        {meter.baseline !== null && (
          <div
            className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-violet-bright/50"
            style={{ bottom: `${Math.min(100, (meter.baseline / max) * 100)}%` }}
          >
            <span className="absolute right-0 -top-4 font-mono text-[0.5625rem] text-violet-bright/70">
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
              ? 'bg-gold'
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
        <span className="flex items-center gap-1"><span className="h-2 w-2 bg-gold" aria-hidden="true" /> flagged spike</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 bg-violet-bright/50" aria-hidden="true" /> spans missing period</span>
      </div>
    </div>
  )
}

export default function Resources() {
  const { workspace, analysis, refresh, can } = useAuth()
  const [tab, setTab] = useState<TabId>('overview')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)

  const canManage = can('manage-inventory')
  if (!workspace || !analysis) return null
  const data = workspace.dataset
  const utilities = analysis.utilities

  const buildingOptions = data.buildings.map((building) => ({ value: building.id, label: building.name }))
  const meterOptions = data.utilityMeters.map((meter) => ({
    value: meter.id,
    label: `${meter.label} — ${meter.unit} (${titleCase(meter.readingType)})`,
  }))

  const meterById = new Map(data.utilityMeters.map((meter) => [meter.id, meter]))
  const buildingById = new Map(data.buildings.map((building) => [building.id, building]))

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'meters', label: 'Meters', count: data.utilityMeters.length },
    { id: 'readings', label: 'Readings', count: data.utilityReadings.length },
    { id: 'tariffs', label: 'Tariffs', count: data.tariffs.length },
  ]

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
          { key: 'ratePerUnit', label: 'Rate per unit', type: 'number', required: true },
          { key: 'standingChargePerPeriod', label: 'Standing charge per period', type: 'number' },
          { key: 'effectiveFrom', label: 'Effective from', type: 'date', required: true },
          { key: 'note', label: 'Source note', type: 'textarea', help: 'Record the tariff source so estimates are not mistaken for supplied prices.' },
        ]
      default:
        return []
    }
  }

  const addLabel = () => (tab === 'meters' ? 'Add meter' : tab === 'readings' ? 'Add reading' : 'Add tariff')
  const currentEntity = () => (tab === 'meters' ? 'utilityMeters' : tab === 'readings' ? 'utilityReadings' : 'tariffs')

  const remove = async () => {
    if (!pendingDelete) return
    await api.deleteRecord(pendingDelete.entity, pendingDelete.id)
    await refresh()
  }

  return (
    <div>
      <PageHeading
        kicker="Module 03 — Resources"
        title="Electricity and water"
        description="Recorded consumption, estimated costs and flagged readings that look unusual. Missing readings stay missing, meter resets never create negative consumption, and every flag points back to its reading."
      />

      {!canManage && (
        <p className="mb-6 border border-gold/40 bg-gold/5 px-4 py-3 text-sm text-ivory/70">
          Meter readings are read-only for your role. Estates officers maintain meters, readings and tariffs.
        </p>
      )}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Electricity recorded"
          value={utilities.totals.electricity.consumption === null ? 'Not available' : `${formatNumber(utilities.totals.electricity.consumption)} kWh`}
          detail={
            utilities.totals.electricity.cost === null
              ? 'Enter a tariff rate to estimate cost'
              : `Estimated ${formatCurrency(utilities.totals.electricity.cost, utilities.totals.electricity.currency)}${utilities.totals.electricity.costComplete ? '' : ' (partial — some periods lack a tariff rate)'}`
          }
        />
        <Stat
          label="Water recorded"
          value={utilities.totals.water.consumption === null ? 'Not available' : `${formatNumber(utilities.totals.water.consumption)} m³`}
          detail={
            utilities.totals.water.cost === null
              ? 'Enter a tariff rate to estimate cost'
              : `Estimated ${formatCurrency(utilities.totals.water.cost, utilities.totals.water.currency)}${utilities.totals.water.costComplete ? '' : ' (partial)'}`
          }
        />
        <Stat
          label="Missing readings"
          value={utilities.missingCount}
          detail="Excluded from totals — totals are lower bounds"
          tone={utilities.missingCount > 0 ? 'high' : 'default'}
        />
        <Stat
          label="Flags"
          value={`${utilities.spikeCount} / ${utilities.resetCount}`}
          detail="Spikes / meter resets"
          tone={utilities.spikeCount > 0 || utilities.resetCount > 0 ? 'high' : 'default'}
        />
      </div>

      <Panel
        actions={
          canManage && (tab === 'meters' || tab === 'readings' || tab === 'tariffs') ? (
            <button
              type="button"
              onClick={() => setEditor({ entity: currentEntity(), initial: null, title: addLabel() })}
              className="rounded-md bg-violet px-3.5 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring"
            >
              {addLabel()}
            </button>
          ) : null
        }
      >
        <Tabs tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} label="Resource views" />

        <div className="mt-6">
          {tab === 'overview' && (
            <div className="space-y-8">
              {utilities.meters.length === 0 ? (
                <EmptyPanel title="No meters recorded">Add a meter to begin recording electricity or water consumption.</EmptyPanel>
              ) : (
                utilities.meters.map((meter) => (
                  <div key={meter.meter.id} className="border border-violet/25 bg-ink/40 p-4 md:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-heading text-lg text-ivory">{meter.meter.label}</p>
                        <p className="mt-0.5 text-xs text-ivory/50">
                          {meter.buildingName} · {titleCase(meter.meter.utility)} · {titleCase(meter.meter.readingType)} · {meter.meter.unit}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={meter.quality === 'ok' ? 'ok' : meter.quality === 'limited' ? 'warn' : 'error'}>
                          {titleCase(meter.quality)} data
                        </Badge>
                        {meter.spikes.length > 0 && <Badge tone="gold">{meter.spikes.length} spike(s)</Badge>}
                        {meter.resets.length > 0 && <Badge tone="warn">{meter.resets.length} reset(s)</Badge>}
                        {meter.missingReadings > 0 && <Badge tone="neutral">{meter.missingReadings} missing</Badge>}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                      <div>
                        <ConsumptionChart meter={meter} />
                      </div>
                      <dl className="space-y-2 text-sm">
                        <div className="flex justify-between gap-3 border-b border-violet/15 pb-1.5">
                          <dt className="text-ivory/55">Known consumption</dt>
                          <dd className="font-mono text-ivory">{formatNumber(meter.knownConsumption)} {meter.meter.unit} <span className="text-ivory/40">({meter.knownPeriods} period(s))</span></dd>
                        </div>
                        <div className="flex justify-between gap-3 border-b border-violet/15 pb-1.5">
                          <dt className="text-ivory/55">Latest period</dt>
                          <dd className="font-mono text-right text-ivory">
                            {meter.latestKnownConsumption === null ? 'Not available' : `${formatNumber(meter.latestKnownConsumption)} ${meter.meter.unit}`}
                            <span className="block text-[0.625rem] text-ivory/40">{meter.latestKnownAt ? formatDate(meter.latestKnownAt) : ''}</span>
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3 border-b border-violet/15 pb-1.5">
                          <dt className="text-ivory/55">Change vs prior median</dt>
                          <dd className="font-mono text-ivory">{meter.changePct === null ? 'Not available' : percentage(meter.changePct, 1)}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-ivory/55">Estimated cost</dt>
                          <dd className="font-mono text-right text-ivory">
                            {meter.estimatedCost === null ? 'No tariff' : formatCurrency(meter.estimatedCost, meter.costCurrency)}
                            {!meter.costComplete && meter.periodsWithoutTariff > 0 && (
                              <span className="block text-[0.625rem] text-gold">{meter.periodsWithoutTariff} period(s) without tariff</span>
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    {(meter.spikes.length > 0 || meter.gaps.length > 0 || meter.resets.length > 0) && (
                      <div className="mt-4 border-t border-violet/20 pt-3">
                        <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Why this is flagged</p>
                        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ivory/65">
                          {meter.spikes.map((spike) => (
                            <li key={spike.readingId}>
                              <span className="text-gold">Spike</span> — {formatNumber(spike.consumption)} {meter.meter.unit} at {formatDate(spike.at)}; series median {formatNumber(spike.baseline)}, {percentage(spike.deviationPct, 0)} above.
                            </li>
                          ))}
                          {meter.gaps.map((gap, index) => (
                            <li key={`${gap.readingId}-${index}`}>
                              <span className="text-ivory/80">Missing</span> — {gap.detail} ({formatDate(gap.at)}).
                            </li>
                          ))}
                          {meter.resets.map((reset) => (
                            <li key={reset.readingId}>
                              <span className="text-gold">Reset</span> — register fell {formatNumber(reset.previousValue)} → {formatNumber(reset.value)} at {formatDate(reset.at)}; no negative consumption produced.
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'meters' && (
            data.utilityMeters.length === 0 ? (
              <EmptyPanel title="No meters recorded">Add electricity and water meters for each building.</EmptyPanel>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse">
                  <thead><tr className="border-b border-violet/30">
                    <th className={thClass}>Meter</th><th className={thClass}>Building</th><th className={thClass}>Utility</th><th className={thClass}>Unit</th><th className={thClass}>Reading type</th><th className={thClass}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {data.utilityMeters.map((meter) => (
                      <tr key={meter.id} className="border-b border-violet/15 last:border-0">
                        <td className={tdClass}><span className="text-ivory">{meter.label}</span><span className="mt-0.5 block font-mono text-[0.625rem] text-ivory/35">{meter.id}</span></td>
                        <td className={tdClass}>{buildingById.get(meter.buildingId)?.name ?? '—'}</td>
                        <td className={tdClass}>{titleCase(meter.utility)}</td>
                        <td className={tdClass}>{meter.unit}</td>
                        <td className={tdClass}>{titleCase(meter.readingType)}</td>
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

          {tab === 'readings' && (
            data.utilityReadings.length === 0 ? (
              <EmptyPanel title="No readings recorded">Add readings to compute consumption. Empty values are kept as gaps.</EmptyPanel>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse">
                  <thead><tr className="border-b border-violet/30">
                    <th className={thClass}>Meter</th><th className={thClass}>Read at</th><th className={thClass}>Value</th><th className={thClass}>Unit</th><th className={thClass}>Note</th><th className={thClass}>Actions</th>
                  </tr></thead>
                  <tbody>
                    {[...data.utilityReadings].sort((a, b) => b.readAt.localeCompare(a.readAt)).map((reading) => (
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

          {tab === 'tariffs' && (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-ivory/60">
                A tariff matches by utility, unit and effective date. The latest tariff that starts on or before a
                reading is used; standing charges are shown but not allocated to individual periods. The seeded
                tariffs are blank placeholders: enter the rate and standing charge from your own bill. MicroCity does
                not supply or verify prices.
              </p>
              {data.tariffs.length === 0 ? (
                <EmptyPanel title="No tariffs configured">Cost estimates stay unavailable until a tariff is recorded.</EmptyPanel>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse">
                    <thead><tr className="border-b border-violet/30">
                      <th className={thClass}>Utility</th><th className={thClass}>Unit</th><th className={thClass}>Rate</th><th className={thClass}>Standing charge</th><th className={thClass}>Currency</th><th className={thClass}>Effective from</th><th className={thClass}>Note</th><th className={thClass}>Actions</th>
                    </tr></thead>
                    <tbody>
                      {data.tariffs.map((tariff) => (
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

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Panel kicker="Reading rules" title="How unusual readings are flagged">
          <ul className="space-y-2 text-sm leading-relaxed text-ivory/70">
            <li>• At least {SPIKE_RULE.minimumPeriods} usable periods are required before a reading can be flagged.</li>
            <li>• A reading is flagged when it is well above the meter's usual level.</li>
            <li>• A flag is a prompt to investigate — not a diagnosis. Weather, occupancy and meter faults are not in the readings.</li>
          </ul>
          <details className="mt-4 border-t border-violet/25 pt-3">
            <summary className="cursor-pointer font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright">
              How is this calculated?
            </summary>
            <ul className="mt-2 space-y-2 text-xs leading-relaxed text-ivory/55">
              <li>• A value is flagged when its robust z-score (median/MAD) exceeds {SPIKE_RULE.robustZ} and it is at least {Math.round(SPIKE_RULE.minimumRelativeExcess * 100)}% above the series median.</li>
              <li>• On a flat series (zero median absolute deviation) a value at least {SPIKE_RULE.flatSeriesMultiple}× the median is flagged.</li>
            </ul>
          </details>
        </Panel>
        <Panel kicker="Reading rules" title="Why totals can be lower bounds">
          <ul className="space-y-2 text-sm leading-relaxed text-ivory/70">
            <li>• Missing readings are excluded, never replaced or counted as zero.</li>
            <li>• A falling cumulative register is treated as a reset; no negative consumption is produced.</li>
            <li>• A difference spanning a missing reading or more than {SPIKE_RULE.gapDays} days is reported as a multi-period total and excluded from trend and flag tests.</li>
            <li>• Costs are estimates from recorded tariffs and are not supplier invoices.</li>
          </ul>
          <div className="mt-4">
            <Notice tone="info">
              These rules are applied by the server. An optional written summary can explain these figures; it cannot
              recalculate or replace them.
            </Notice>
          </div>
        </Panel>
      </div>

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
