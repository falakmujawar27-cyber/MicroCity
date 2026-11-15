import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import NearbyNeeds from '../../components/dashboard/NearbyNeeds'
import FindingExplainer from '../../components/dashboard/FindingExplainer'
import PageHeading from '../../components/dashboard/PageHeading'
import Panel from '../../components/ui/Panel'
import { Badge, StatusBadge } from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import Notice from '../../components/ui/Notice'
import { EmptyPanel } from '../../components/ui/PageState'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../auth/auth-context'
import { formatCurrency, formatDate, formatDateTime } from '../../lib/format'
import {
  buildNeedsCategories,
  NEEDS_THRESHOLDS,
  NEEDS_STATUS_LABELS,
} from '../../domain/analysis'
import type {
  NeedsCategoryKey,
  NeedsCategoryRow,
  NeedsCategoryStatus,
  OptionAnalysis,
} from '../../domain/analysis'
import type { ThresholdKind } from '../../domain/types'
import { THRESHOLD_KIND_LABELS } from '../../domain/types'

const STATUS_TONE: Record<NeedsCategoryStatus, 'error' | 'warn' | 'ok' | 'neutral'> = {
  critical: 'error',
  stressed: 'warn',
  adequate: 'ok',
  not_enough_data: 'neutral',
}

const STATUS_ICON: Record<NeedsCategoryStatus, string> = {
  critical: '▲',
  stressed: '◆',
  adequate: '●',
  not_enough_data: '?',
}

function CategoryStatusBadge({ row }: { row: NeedsCategoryRow }) {
  return (
    <Badge tone={STATUS_TONE[row.status]}>
      <span aria-hidden="true" className="text-[0.6875rem] leading-none">{STATUS_ICON[row.status]}</span>
      {row.statusLabel}
    </Badge>
  )
}

function optionEffect(option: OptionAnalysis): string {
  if (option.seatEffect !== null) {
    return `+${option.seatEffect} seat${option.seatEffect === 1 ? '' : 's'} of headroom${option.seatEffectComplete ? '' : ' (partial evidence)'}`
  }
  return option.description || 'Not entered'
}

export default function NeedsGaps() {
  const { analysis, workspace, role, refresh } = useAuth()
  const [searchParams] = useSearchParams()
  const [area, setArea] = useState<'campus' | 'nearby'>(searchParams.get('area') === 'nearby' ? 'nearby' : 'campus')
  const [selectedKey, setSelectedKey] = useState<NeedsCategoryKey>('rooms')
  const [methodOpen, setMethodOpen] = useState(false)
  const [busyOption, setBusyOption] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [limitDraft, setLimitDraft] = useState<{
    limit: string
    unit: string
    source: string
    kind: ThresholdKind
  }>({ limit: '', unit: 'm3', source: '', kind: 'project_assumption' })
  const [limitBusy, setLimitBusy] = useState(false)
  const [limitError, setLimitError] = useState<string | null>(null)
  const [limitSaved, setLimitSaved] = useState<string | null>(null)

  const waterLimit = workspace?.needsLimits?.find((limit) => limit.category === 'water') ?? null

  useEffect(() => {
    if (!waterLimit) return
    setLimitDraft({
      limit: String(waterLimit.limit),
      unit: waterLimit.unit,
      source: waterLimit.source,
      kind: waterLimit.kind,
    })
  }, [waterLimit?.updatedAt])

  const categories = useMemo(() => {
    if (!analysis || !workspace) return []
    return buildNeedsCategories(
      workspace.dataset,
      analysis.capacity,
      analysis.utilities,
      analysis.findings,
      workspace.needsLimits ?? [],
    )
  }, [analysis, workspace])

  if (!analysis || !workspace) return null

  const selected = categories.find((row) => row.key === selectedKey) ?? categories[0]
  const gapOptions = analysis.plan.options.filter((option) =>
    selected.findingIds.includes(option.addressesFinding),
  )
  const selectedFinding = analysis.findings.find((finding) => finding.id === selected.findingIds[0])
  const shownOptions = gapOptions.slice(0, 2)
  const gapLabel =
    selected.key === 'rooms' && selected.facts.roomCode
      ? `Room ${selected.facts.roomCode}`
      : selected.label
  const decisions = workspace.dataset.decisions
    .filter((decision) => gapOptions.some((option) => option.optionId === decision.optionId))
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt))
  const optionTitle = (optionId: string) =>
    gapOptions.find((option) => option.optionId === optionId)?.title ?? 'Option no longer recorded'

  async function approve(option: OptionAnalysis) {
    setError(null)
    setBusyOption(option.optionId)
    try {
      let decisionId = option.decision?.decisionId ?? null
      if (!decisionId) {
        const created = await api.createDecision({
          optionId: option.optionId,
          title: option.title,
          notes: 'Recorded from Needs and Gaps.',
        })
        decisionId = created.record.id
      }
      await api.updateDecision(decisionId, { status: 'approved' })
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The approval could not be recorded.')
    } finally {
      setBusyOption(null)
    }
  }

  async function propose(option: OptionAnalysis) {
    setError(null)
    setBusyOption(option.optionId)
    try {
      await api.createDecision({
        optionId: option.optionId,
        title: option.title,
        notes: 'Proposed from Needs and Gaps. An administrator must record the decision.',
      })
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The proposal could not be recorded.')
    } finally {
      setBusyOption(null)
    }
  }

  async function saveLimit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLimitBusy(true)
    setLimitError(null)
    setLimitSaved(null)
    try {
      await api.saveNeedsLimit('water', {
        limit: Number(limitDraft.limit),
        unit: limitDraft.unit.trim(),
        source: limitDraft.source.trim(),
        kind: limitDraft.kind,
      })
      await refresh()
      setLimitSaved('The Water limit and its source were saved. The Water row now compares the latest known month with it.')
    } catch (err) {
      setLimitError(err instanceof ApiError ? err.message : 'The limit could not be saved.')
    } finally {
      setLimitBusy(false)
    }
  }

  return (
    <div>
      <PageHeading
        kicker="Module 02 — Needs and Gaps"
        title="Needs and Gaps"
        description="Campus demand against capacity, or nearby infrastructure condition. Missing evidence is shown as Not enough data, never assumed Adequate."
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ivory/45">
          Statuses and thresholds are rule-based; optional AI only explains the recorded finding below.
        </p>
        <div className="inline-flex border border-violet/40" role="group" aria-label="Area">
          {(['campus', 'nearby'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={area === value}
              onClick={() => setArea(value)}
              className={`px-4 py-1.5 font-mono text-[0.6875rem] uppercase tracking-widest focus-ring ${
                area === value
                  ? 'bg-violet text-ivory'
                  : 'text-ivory/60 hover:bg-violet/15'
              }`}
            >
              {value === 'campus' ? 'Campus' : 'Nearby area'}
            </button>
          ))}
        </div>
      </div>

      {area === 'nearby' ? (
        <NearbyNeeds initialType={searchParams.get('type')} />
      ) : (
        <div className="space-y-8">
          <Panel kicker="Five categories" title="Demand vs capacity">
            <div className="overflow-x-auto">
              <table className="block w-full border-collapse text-left sm:table">
                <caption className="sr-only">Needs categories with demand against capacity and status</caption>
                <thead className="hidden sm:table-header-group">
                  <tr className="border-b border-violet/30">
                    <th className="py-2 pr-3 font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Category</th>
                    <th className="py-2 pr-3 font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Demand vs capacity</th>
                    <th className="py-2 text-right font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Status</th>
                  </tr>
                </thead>
                <tbody className="block sm:table-row-group">
                  {categories.map((row) => (
                    <tr
                      key={row.key}
                      className={`flex flex-wrap items-center gap-x-3 border-b border-violet/15 py-3 align-top last:border-0 sm:table-row sm:py-0 ${
                        row.key === selected.key ? 'bg-violet/10' : ''
                      }`}
                    >
                      <td className="order-1 py-0 pr-0 align-top sm:table-cell sm:py-3 sm:pr-3">
                        <button
                          type="button"
                          onClick={() => setSelectedKey(row.key)}
                          aria-pressed={row.key === selected.key}
                          className={`text-left text-sm hover:text-violet-bright focus-ring ${
                            row.key === selected.key ? 'font-semibold text-ivory' : 'text-ivory/75'
                          }`}
                        >
                          {row.label}
                        </button>
                      </td>
                      <td className="order-3 w-full pt-1 text-sm text-ivory/70 sm:table-cell sm:w-auto sm:py-3 sm:pr-3 sm:pt-3 sm:align-top">
                        <p>{row.demand}</p>
                        {row.key === 'rooms' && (
                          <p className="mt-0.5 text-xs text-ivory/45">
                            Status decided by Needs Score {row.facts.decidingScore ?? 'not scored'} of 100 ·{' '}
                            {row.facts.sessionsUsed} of {row.facts.sessionsTotal} sessions recorded · average present{' '}
                            {row.facts.averagePresent ?? 'not recorded'} per session (not summed)
                          </p>
                        )}
                      </td>
                      <td className="order-2 ml-auto py-0 align-top sm:table-cell sm:py-3 sm:text-right">
                        <CategoryStatusBadge row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel kicker="Thresholds and sources" title="The limit used for Water">
            <p className="text-sm leading-relaxed text-ivory/70">
              Only Water has a rule in this build that takes a limit: each water meter&rsquo;s latest known month is
              compared with one recorded monthly limit. The limit is a quantity in the meter&rsquo;s unit (m3 here),
              not a percentage. Rooms use the Needs Score bands (a project assumption); Lighting, Waste and Parking
              have no rule that takes a limit, so no limit field is offered for them.
            </p>
            {!waterLimit ? (
              <p className="mt-3 text-sm leading-relaxed text-ivory/70">
                No Water limit is recorded, so the Water row is <strong className="text-ivory">Not enough data</strong>.
                No default is applied.
              </p>
            ) : (
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Limit</dt>
                  <dd className="text-ivory">
                    {waterLimit.limit} {waterLimit.unit} per meter per month
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Type</dt>
                  <dd className="text-ivory">{THRESHOLD_KIND_LABELS[waterLimit.kind]}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Source</dt>
                  <dd className="text-ivory">{waterLimit.source}</dd>
                </div>
                <div className="sm:col-span-2 text-xs text-ivory/45">
                  Recorded by {waterLimit.updatedByName} on {formatDate(waterLimit.updatedAt)}.
                </div>
              </dl>
            )}

            {role === 'admin' ? (
              <form onSubmit={(event) => void saveLimit(event)} className="mt-4 border-t border-violet/15 pt-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block text-xs text-ivory/70">
                    Limit
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={limitDraft.limit}
                      onChange={(event) => setLimitDraft((current) => ({ ...current, limit: event.target.value }))}
                      className="mt-1 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                    />
                  </label>
                  <label className="block text-xs text-ivory/70">
                    Unit
                    <input
                      required
                      maxLength={24}
                      value={limitDraft.unit}
                      onChange={(event) => setLimitDraft((current) => ({ ...current, unit: event.target.value }))}
                      className="mt-1 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                    />
                  </label>
                  <label className="block text-xs text-ivory/70 sm:col-span-2">
                    Source (required)
                    <input
                      required
                      maxLength={200}
                      value={limitDraft.source}
                      placeholder="For example: college water policy 2026, section 4"
                      onChange={(event) => setLimitDraft((current) => ({ ...current, source: event.target.value }))}
                      className="mt-1 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                    />
                  </label>
                  <label className="block text-xs text-ivory/70 sm:col-span-2">
                    Type
                    <select
                      value={limitDraft.kind}
                      onChange={(event) =>
                        setLimitDraft((current) => ({ ...current, kind: event.target.value as ThresholdKind }))
                      }
                      className="mt-1 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                    >
                      <option value="project_assumption">{THRESHOLD_KIND_LABELS.project_assumption}</option>
                      <option value="published_norm">{THRESHOLD_KIND_LABELS.published_norm}</option>
                    </select>
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={limitBusy}
                    className="rounded-md bg-violet px-4 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {limitBusy ? 'Saving…' : 'Save limit and source'}
                  </button>
                  <span className="text-xs text-ivory/45">
                    Administrators only. Estates can see the saved limit but cannot change it. Every change is audited
                    with the old and new value.
                  </span>
                </div>
                {limitError && <Notice tone="danger" className="mt-3">{limitError}</Notice>}
                {limitSaved && <Notice tone="success" className="mt-3">{limitSaved}</Notice>}
              </form>
            ) : (
              <p className="mt-4 border-t border-violet/15 pt-3 text-xs leading-relaxed text-ivory/45">
                Read-only: only an administrator can record or change the limit, its unit, type or source. The saved
                value above is used by the Water row.
              </p>
            )}
          </Panel>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,2fr)]">
            <Panel kicker="Rule-based explanation" title={`Why is ${selected.label} ${NEEDS_STATUS_LABELS[selected.status].toLowerCase()}?`}>
              <ul className="space-y-2 text-sm leading-relaxed text-ivory/75">
                {selected.why.slice(0, 3).map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-ivory/45">
                {selected.findingIds.length > 0
                  ? `Finding feeding this row: ${
                      analysis.findings.find((finding) => finding.id === selected.findingIds[0])?.title ??
                      selected.findingIds[0]
                    }${selected.findingIds.length > 1 ? ` and ${selected.findingIds.length - 1} more` : ''}.`
                  : 'No computed finding feeds this row.'}
              </p>
              {selectedFinding && <FindingExplainer finding={selectedFinding} compact />}
              <button
                type="button"
                onClick={() => setMethodOpen(true)}
                className="mt-3 text-sm font-semibold text-violet-bright underline underline-offset-4 hover:text-ivory focus-ring"
              >
                How is this calculated?
              </button>
              <p className="mt-2 text-[0.6875rem] text-ivory/40">
                Rule-based explanation — not AI. Room thresholds are a project assumption (not a published norm).
                {waterLimit
                  ? ` Water limit: ${waterLimit.limit} ${waterLimit.unit} per meter per month (${THRESHOLD_KIND_LABELS[waterLimit.kind]}; source: ${waterLimit.source}).`
                  : ' No Water limit is recorded, so Water shows Not enough data and no ratio is calculated.'}{' '}
                Lighting, Waste and Parking have no rule that takes a limit.
              </p>
            </Panel>

            <Panel
              kicker="Options"
              title={`Choose an option for ${gapLabel}`}
              actions={
                gapOptions.length > 0 ? (
                  <Link
                    to="/dashboard/plan-report"
                    className="font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright hover:text-ivory focus-ring"
                  >
                    Plan and Report
                  </Link>
                ) : undefined
              }
            >
              <Notice tone="warning" className="mb-4">
                Cost is what someone entered on the option. “Cost: not entered” means no figure is recorded; MicroCity
                does not estimate it.
              </Notice>
              {shownOptions.length === 0 ? (
                <EmptyPanel title="No option is recorded for this gap">
                  <p>No plan option targets the findings feeding {selected.label.toLowerCase()}.</p>
                  <Link
                    to="/dashboard/plan-report"
                    className="mt-3 inline-block rounded border border-violet/50 px-3 py-1.5 text-sm text-violet-bright hover:bg-violet/15 focus-ring"
                  >
                    Open Plan and Report
                  </Link>
                </EmptyPanel>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {shownOptions.map((option) => (
                    <article key={option.optionId} className="flex flex-col border border-violet/30 bg-ink/40 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-heading text-lg text-ivory">{option.title}</h3>
                        {option.approvalState !== 'none' && <StatusBadge status={option.approvalState} />}
                      </div>
                      <dl className="mt-3 space-y-2 text-sm leading-relaxed">
                        <div>
                          <dt className="sr-only">Cost</dt>
                          <dd className="text-ivory/70">
                            Cost:{' '}
                            <span className="text-ivory">
                              {option.capitalCost === null
                                ? 'not entered'
                                : formatCurrency(option.capitalCost, 'INR')}
                            </span>
                          </dd>
                        </div>
                        <div>
                          <dt className="sr-only">Effect</dt>
                          <dd className="text-ivory/70">Effect: <span className="text-ivory">{optionEffect(option)}</span></dd>
                        </div>
                        <div>
                          <dt className="sr-only">Assumption</dt>
                          <dd className="text-ivory/70">
                            Assumption: <span className="text-ivory">{option.assumptions || 'None recorded'}</span>
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-auto pt-4">
                        {role === 'admin' ? (
                          <button
                            type="button"
                            onClick={() => void approve(option)}
                            disabled={busyOption === option.optionId || option.approvalState === 'approved'}
                            className="w-full rounded-md bg-violet px-4 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {option.approvalState === 'approved'
                              ? 'Approved'
                              : busyOption === option.optionId
                                ? 'Approving…'
                                : 'Approve'}
                          </button>
                        ) : role === 'estates' ? (
                          <button
                            type="button"
                            onClick={() => void propose(option)}
                            disabled={
                              busyOption === option.optionId ||
                              option.approvalState === 'proposed' ||
                              option.approvalState === 'approved'
                            }
                            className="w-full rounded-md border border-violet/50 px-4 py-2 text-sm font-semibold text-violet-bright hover:bg-violet/15 focus-ring disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {option.approvalState === 'approved'
                              ? 'Approved'
                              : option.approvalState === 'proposed'
                                ? 'Proposed'
                                : busyOption === option.optionId
                                  ? 'Proposing…'
                                  : 'Propose'}
                          </button>
                        ) : (
                          <p className="text-xs italic text-ivory/45">Your role cannot approve or propose here.</p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {gapOptions.length > shownOptions.length && (
                <p className="mt-3 text-xs text-ivory/45">
                  Showing the first two recorded options. The rest are on Plan and Report.
                </p>
              )}
              {error && <Notice tone="danger" className="mt-4">{error}</Notice>}
            </Panel>
          </div>

          <Panel kicker="Decision log" title={`Decisions for ${gapLabel}`}>
            {decisions.length === 0 ? (
              <EmptyPanel title="No decision is recorded for this gap">
                <p>A proposal must be recorded before an administrator can approve, reject or defer it.</p>
                <Link
                  to="/dashboard/plan-report"
                  className="mt-3 inline-block rounded border border-violet/50 px-3 py-1.5 text-sm text-violet-bright hover:bg-violet/15 focus-ring"
                >
                  Open Plan and Report
                </Link>
              </EmptyPanel>
            ) : (
              <ul className="divide-y divide-violet/20">
                {decisions.map((decision) => (
                  <li key={decision.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={decision.status} />
                      <span className="text-xs text-ivory/45">{optionTitle(decision.optionId)}</span>
                    </div>
                    <p className="mt-1.5 text-sm text-ivory">{decision.title}</p>
                    <p className="mt-0.5 text-xs text-ivory/55">
                      Owner: {decision.ownerName ?? 'not assigned'} ·{' '}
                      {decision.decidedAt
                        ? `${decision.status === 'approved' ? 'Approved' : decision.status === 'rejected' ? 'Rejected' : 'Deferred'} by ${
                            decision.decidedByName ?? 'an administrator'
                          } on ${formatDateTime(decision.decidedAt)}`
                        : `Proposed ${formatDateTime(decision.createdAt)}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 border-t border-violet/15 pt-3 text-xs leading-relaxed text-ivory/45">
              Only an administrator can approve, reject or defer. Every status change records who and when on the
              server.
            </p>
          </Panel>
        </div>
      )}

      <Modal
        open={methodOpen}
        onClose={() => setMethodOpen(false)}
        title={`How ${selected.label} is calculated`}
        description="The recorded figures and rules behind this row. No AI text is used."
        size="lg"
      >
        <div className="border border-violet/40 bg-ink/60 p-4">
          <p className="flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright">
            <span aria-hidden="true" className="inline-block h-2 w-2 border border-violet-bright" />
            Rule-based explanation — not AI
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ivory/70">
            {selected.method.map((line, index) => (
              <li key={index}>• {line}</li>
            ))}
          </ul>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ivory/45">
          Room bands: Adequate below {NEEDS_THRESHOLDS.stressed}, Stressed {NEEDS_THRESHOLDS.stressed}–
          {NEEDS_THRESHOLDS.critical - 1}, Critical {NEEDS_THRESHOLDS.critical} and above. Missing values remain missing
          and are never treated as zero.
        </p>
      </Modal>
    </div>
  )
}
