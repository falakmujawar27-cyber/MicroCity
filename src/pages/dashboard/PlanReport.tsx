import { useState } from 'react'
import type { FormEvent } from 'react'
import PageHeading from '../../components/dashboard/PageHeading'
import Panel from '../../components/ui/Panel'
import Tabs from '../../components/ui/Tabs'
import Stat from '../../components/ui/Stat'
import { Badge, StatusBadge } from '../../components/ui/Badge'
import Notice from '../../components/ui/Notice'
import RecordDialog from '../../components/ui/RecordDialog'
import type { FormField } from '../../components/ui/RecordDialog'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Modal from '../../components/ui/Modal'
import FindingExplainer from '../../components/dashboard/FindingExplainer'
import PrintReport from '../../components/dashboard/PrintReport'
import { EmptyPanel } from '../../components/ui/PageState'
import { Field, FormError, inputClass } from '../../components/ui/Form'
import { api, ApiError } from '../../lib/api'
import type { AiAssistResponse } from '../../lib/api'
import { useAuth } from '../../auth/auth-context'
import { downloadFile } from '../../lib/download'
import {
  buildReportCsv,
  buildReportFacts,
  buildReportMarkdown,
  reportFileName,
} from '../../lib/reports'
import type { ReportSummary } from '../../lib/reports'
import { formatCurrency, formatDateTime, titleCase } from '../../lib/format'
import { ROLE_LABELS, THRESHOLD_KIND_LABELS } from '../../domain/types'
import type { Decision, DecisionStatus } from '../../domain/types'
import type { Finding as AnalysisFinding } from '../../domain/analysis'

type TabId = 'options' | 'decisions' | 'report'

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

const OPTION_TYPES = [
  { value: 'timetable', label: 'Timetable' },
  { value: 'capacity', label: 'Capacity' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'other', label: 'Other' },
]

const DECISION_STATUS_OPTIONS = [
  { value: 'proposed', label: 'Proposed' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'deferred', label: 'Deferred' },
]

/** The fixed lookup list, mirrored in the interface for the no-AI buttons. */
const LOOKUP_BUTTONS = [
  { id: 'rooms-over-capacity', label: 'Rooms over capacity' },
  { id: 'meters-with-spikes', label: 'Meters with spikes' },
  { id: 'open-critical-issues', label: 'Open critical issues' },
  { id: 'nearby-critical', label: 'Nearby types in Critical status' },
  { id: 'decisions-waiting', label: 'Decisions waiting' },
]

function money(value: number | null): string {
  return value === null ? 'Not recorded' : formatCurrency(value, 'INR')
}

/* ------------------------------------------------------------------ */
/* Decision dialog — uses the dedicated decision endpoint.            */
/* ------------------------------------------------------------------ */

function DecisionDialog({
  open,
  onClose,
  onSaved,
  optionId,
  decision,
  options,
  ownerOptions,
  isAdmin,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => Promise<void>
  optionId: string | null
  decision: Decision | null
  options: { value: string; label: string }[]
  ownerOptions: { value: string; label: string }[]
  isAdmin: boolean
}) {
  const [selectedOption, setSelectedOption] = useState(decision?.optionId ?? optionId ?? '')
  const [title, setTitle] = useState(
    decision?.title ?? (options.find((option) => option.value === (optionId ?? ''))?.label ?? ''),
  )
  const [ownerUserId, setOwnerUserId] = useState(decision?.ownerUserId ?? '')
  const [followUp, setFollowUp] = useState(decision?.followUp ?? '')
  const [notes, setNotes] = useState(decision?.notes ?? '')
  const [status, setStatus] = useState(decision?.status ?? 'proposed')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (decision) {
        await api.updateDecision(decision.id, {
          title: title.trim(),
          ownerUserId: ownerUserId || null,
          followUp: followUp.trim(),
          notes: notes.trim(),
          ...(isAdmin ? { status } : {}),
        })
      } else {
        await api.createDecision({
          optionId: selectedOption,
          title: title.trim(),
          ownerUserId: ownerUserId || null,
          followUp: followUp.trim(),
          notes: notes.trim(),
        })
      }
      await onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The decision could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={decision ? 'Edit decision' : 'Record a proposed decision'}
      description={
        decision
          ? 'Only an administrator can change the recorded status. Option links cannot be changed.'
          : 'Recording a proposal does not approve it. An administrator must record the approval, rejection or deferral.'
      }
      size="lg"
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        {!decision && (
          <Field label="Plan option" htmlFor="decision-option" required>
            <select id="decision-option" value={selectedOption} onChange={(e) => setSelectedOption(e.target.value)} className={inputClass} required>
              <option value="">Choose an option…</option>
              {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
        )}
        <Field label="Decision title" htmlFor="decision-title" required>
          <input id="decision-title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owner" htmlFor="decision-owner">
            <select id="decision-owner" value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} className={inputClass}>
              <option value="">No owner</option>
              {ownerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          {decision && isAdmin && (
            <Field label="Status" htmlFor="decision-status" help="Changing status records you and the current time.">
              <select id="decision-status" value={status} onChange={(e) => setStatus(e.target.value as DecisionStatus)} className={inputClass}>
                {DECISION_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Field>
          )}
        </div>
        <Field label="Follow-up" htmlFor="decision-followup">
          <textarea id="decision-followup" rows={2} value={followUp} onChange={(e) => setFollowUp(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Notes" htmlFor="decision-notes">
          <textarea id="decision-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
        </Field>
        <div className="flex justify-end gap-3 border-t border-violet/30 pt-4">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-violet/40 px-4 py-2 text-sm text-ivory/80 hover:bg-violet/15 focus-ring disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={busy || (!decision && !selectedOption)} className="rounded-md bg-violet px-4 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:opacity-50">
            {busy ? 'Saving…' : decision ? 'Save decision' : 'Record proposal'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                               */
/* ------------------------------------------------------------------ */

export default function PlanReport() {
  const { workspace, analysis, refresh, role, session, ai } = useAuth()
  const [tab, setTab] = useState<TabId>('options')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [explained, setExplained] = useState<AnalysisFinding | null>(null)
  const [decisionDialog, setDecisionDialog] = useState<{ optionId: string | null; decision: Decision | null } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [printView, setPrintView] = useState(false)
  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [summaryNote, setSummaryNote] = useState<string | null>(null)
  const [askQuestion, setAskQuestion] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const [askResult, setAskResult] = useState<AiAssistResponse | null>(null)

  if (!workspace || !analysis || !role || !session) return null
  const data = workspace.dataset
  const plan = analysis.plan
  const isAdmin = role === 'admin'
  const canEdit = role === 'admin' || role === 'estates'
  const ownerOptions = workspace.members
    .filter((member) => member.role === 'admin' || member.role === 'estates' || member.role === 'maintenance')
    .map((member) => ({ value: member.id, label: `${member.displayName} — ${ROLE_LABELS[member.role]}` }))
  const optionOptions = data.planOptions.map((option) => ({ value: option.id, label: option.title }))
  const findingOptions = analysis.findings.map((finding) => ({
    value: finding.id,
    label: `${titleCase(finding.severity)} — ${finding.title}`,
  }))
  const waterLimit = workspace.needsLimits.find((limit) => limit.category === 'water') ?? null

  const tabs = [
    { id: 'options', label: 'Options', count: data.planOptions.length },
    { id: 'decisions', label: 'Decisions', count: data.decisions.length },
    { id: 'report', label: 'Report & export' },
  ]

  const optionFields = (): FormField[] => {
    const fields: FormField[] = [
      { key: 'title', label: 'Option title', type: 'text', required: true },
      { key: 'optionType', label: 'Option type', type: 'select', required: true, options: OPTION_TYPES },
      { key: 'description', label: 'Description', type: 'textarea', required: true },
      { key: 'addressesFinding', label: 'Finding this addresses', type: 'select', required: true, options: findingOptions, help: 'Links the option to a finding so priorities without an option stay visible.' },
      { key: 'capitalCost', label: 'Capital cost (₹)', type: 'number' },
      { key: 'annualCost', label: 'Annual cost (₹)', type: 'number' },
      { key: 'annualSavings', label: 'Annual savings (₹)', type: 'number' },
      { key: 'capacityGainSeats', label: 'Capacity gain (seats)', type: 'integer' },
      { key: 'demandReducedSeats', label: 'Demand reduction (seats)', type: 'integer' },
      { key: 'disruptionDays', label: 'Disruption days', type: 'integer' },
      { key: 'implementationWeeks', label: 'Implementation weeks', type: 'integer' },
      { key: 'assumptions', label: 'Assumptions', type: 'textarea', required: true, help: 'State what must hold for the costs and effects to be true.' },
      { key: 'risks', label: 'Risks and trade-offs', type: 'textarea', required: true },
      { key: 'evidence', label: 'Evidence', type: 'textarea', required: true, help: 'Cite the records, quotes or studies behind the figures.' },
    ]
    return fields
  }

  const remove = async () => {
    if (!pendingDelete) return
    await api.deleteRecord(pendingDelete.entity, pendingDelete.id)
    await refresh()
  }

  const updateStatus = async (decision: Decision, status: 'approved' | 'rejected' | 'deferred' | 'proposed') => {
    setActionError(null)
    try {
      await api.updateDecision(decision.id, { status })
      await refresh()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'The decision status could not be changed.')
    }
  }

  const reportInput = {
    workspace,
    analysis,
    preparedBy: session.user.displayName,
    roleLabel: ROLE_LABELS[role],
  }

  /**
   * Five-line summary: AI version through the server number guard when
   * configured; otherwise the deterministic rule-based summary (labelled as
   * not AI) that buildReportMarkdown produces on its own.
   */
  const ensureSummary = async (): Promise<ReportSummary | null> => {
    if (summary) return summary
    if (!ai?.configured || !canEdit) return null
    setSummaryBusy(true)
    setSummaryNote(null)
    try {
      const result = await api.aiAssist({ task: 'report-summary', facts: buildReportFacts(reportInput) })
      if (result.ok && result.accepted && result.text) {
        const lines = result.text
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
        const built: ReportSummary = {
          label: result.label ?? 'AI-generated, please verify',
          source: 'ai',
          lines,
        }
        setSummary(built)
        return built
      }
      if (result.ok && result.accepted === false) {
        setSummaryNote('AI summary rejected: unsupported number. Using the rule-based summary.')
      } else {
        setSummaryNote(result.error ?? 'The assistant did not return a summary. Using the rule-based summary.')
      }
    } catch {
      setSummaryNote('The assistant could not be reached. Using the rule-based summary.')
    } finally {
      setSummaryBusy(false)
    }
    return null
  }

  const downloadReport = async () => {
    const usedSummary = await ensureSummary()
    const markdown = buildReportMarkdown({ ...reportInput, summary: usedSummary })
    downloadFile(reportFileName(workspace.activeCollege.name, analysis.asOf), markdown, 'text/markdown;charset=utf-8')
  }

  const downloadCsv = async () => {
    const usedSummary = await ensureSummary()
    downloadFile(
      reportFileName(workspace.activeCollege.name, analysis.asOf).replace(/\.md$/, '.csv'),
      `\uFEFF${buildReportCsv({ ...reportInput, summary: usedSummary })}`,
      'text/csv;charset=utf-8',
    )
  }

  const findingFor = (id: string) => analysis.findings.find((finding) => finding.id === id) ?? null
  const methodFor = (finding: AnalysisFinding) => {
    if (finding.module === 'capacity') return analysis.capacity.methods
    if (finding.module === 'utilities') return analysis.utilities.methods
    if (finding.module === 'maintenance') return analysis.maintenance.methods
    if (finding.module === 'plan') return analysis.plan.methods
    return []
  }

  const reportMarkdown = tab === 'report'
    ? buildReportMarkdown({ ...reportInput, summary: summary ?? undefined })
    : ''

  const runLookup = async (question: string, lookupId?: string) => {
    setAskBusy(true)
    setAskError(null)
    try {
      const result = lookupId
        ? await api.dataLookup(lookupId)
        : await api.aiAssist({ task: 'ask-data', question })
      setAskResult(result)
      if (!result.ok) setAskError(result.error ?? 'The lookup could not run.')
    } catch (err) {
      setAskError(err instanceof ApiError ? err.message : 'The lookup could not run.')
    } finally {
      setAskBusy(false)
    }
  }

  return (
    <div>
      <PageHeading
        kicker="Module 05 — Plan & Report"
        title="Options, decisions and the record"
        description="Compare recorded options without an automatic recommendation, record who owns what, and export a report. Only an administrator can approve, reject or defer a decision."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Options recorded" value={data.planOptions.length} detail={`${plan.approvalCounts.approved} approved · ${plan.approvalCounts.proposed} proposed`} />
        <Stat label="Awaiting a decision" value={plan.approvalCounts.none + plan.approvalCounts.proposed} detail="No decision yet, including proposals awaiting approval" tone={plan.approvalCounts.none + plan.approvalCounts.proposed > 0 ? 'high' : 'default'} />
        <Stat label="Unaddressed priorities" value={plan.unaddressedFindings.length} detail="Critical or high findings not linked to an option" tone={plan.unaddressedFindings.length > 0 ? 'critical' : 'good'} />
        <Stat label="Findings in report" value={analysis.findings.length} detail={`${analysis.findingCounts.critical} critical · ${analysis.findingCounts.high} high`} />
      </div>

      {actionError && <div className="mb-4"><Notice tone="danger">{actionError}</Notice></div>}

      <Panel
        actions={
          tab === 'options' && canEdit ? (
            <button
              type="button"
              onClick={() => setEditor({ entity: 'planOptions', initial: null, title: 'Add plan option' })}
              className="rounded-md bg-violet px-3.5 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring"
            >
              Add option
            </button>
          ) : tab === 'decisions' && canEdit ? (
            <button
              type="button"
              onClick={() => setDecisionDialog({ optionId: null, decision: null })}
              className="rounded-md bg-violet px-3.5 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring"
            >
              Record decision
            </button>
          ) : null
        }
      >
        <Tabs tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} label="Plan and report views" />

        <div className="mt-6">
          {tab === 'options' && (
            <div className="space-y-4">
              {!canEdit && (
                <Notice tone="info">Your role can read the plan but not change options or decisions.</Notice>
              )}
              {plan.options.length > 0 && (
                <div className="overflow-x-auto border border-violet/25 bg-ink/40">
                  <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
                    <caption className="px-4 pt-4 text-left font-mono text-[0.625rem] uppercase tracking-widest text-gold">
                      Options comparison — costs and effects are Illustrative recorded inputs, not predictions
                    </caption>
                    <thead>
                      <tr className="border-b border-violet/25 font-mono text-[0.625rem] uppercase tracking-wider text-ivory/50">
                        <th scope="col" className="px-4 py-3 font-normal">Option</th>
                        <th scope="col" className="px-4 py-3 font-normal">Type</th>
                        <th scope="col" className="px-4 py-3 text-right font-normal">Capital cost</th>
                        <th scope="col" className="px-4 py-3 text-right font-normal">Net annual benefit</th>
                        <th scope="col" className="px-4 py-3 text-right font-normal">Payback</th>
                        <th scope="col" className="px-4 py-3 text-right font-normal">Seat effect</th>
                        <th scope="col" className="px-4 py-3 font-normal">Decision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.options.map((option) => (
                        <tr key={option.optionId} className="border-b border-violet/15 last:border-0">
                          <th scope="row" className="px-4 py-3 font-medium text-ivory">{option.title}</th>
                          <td className="px-4 py-3 text-ivory/65">{titleCase(option.optionType)}</td>
                          <td className="px-4 py-3 text-right font-mono text-ivory/80">{option.capitalCost === null ? 'Missing' : money(option.capitalCost)}</td>
                          <td className="px-4 py-3 text-right font-mono text-ivory/80">{option.netAnnualBenefit === null ? 'Missing' : money(option.netAnnualBenefit)}</td>
                          <td className="px-4 py-3 text-right font-mono text-ivory/80">{option.simplePaybackMonths === null ? 'Missing' : `${option.simplePaybackMonths.toFixed(1)} mo`}</td>
                          <td className="px-4 py-3 text-right font-mono text-ivory/80">{option.seatEffect === null ? 'Missing' : `${option.seatEffect}${option.seatEffectComplete ? '' : ' (partial)'}`}</td>
                          <td className="px-4 py-3">
                            {option.decision ? <StatusBadge status={option.decision.status} /> : <Badge tone="gold">No decision</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {plan.options.length === 0 ? (
                <EmptyPanel title="No options recorded">Record options with their costs, effects, assumptions, risks and evidence.</EmptyPanel>
              ) : (
                plan.options.map((option) => {
                  const record = data.planOptions.find((item) => item.id === option.optionId)
                  const finding = findingFor(option.addressesFinding)
                  return (
                    <article key={option.optionId} className="border border-violet/25 bg-ink/40 p-4 md:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone="outline">{titleCase(option.optionType)}</Badge>
                            {option.decision ? <StatusBadge status={option.decision.status} /> : <Badge tone="gold">No decision</Badge>}
                            {option.decision?.ownerName && <Badge tone="violet">Owner: {option.decision.ownerName}</Badge>}
                          </div>
                          <h3 className="mt-2 font-heading text-xl text-ivory">{option.title}</h3>
                          <p className="mt-1 text-sm leading-relaxed text-ivory/70">{option.description}</p>
                          <p className="mt-2 text-xs text-ivory/50">
                            Addresses: {finding ? (
                              <button type="button" onClick={() => setExplained(finding)} className="text-violet-bright underline decoration-dotted underline-offset-2 hover:text-gold">
                                {finding.title}
                              </button>
                            ) : option.addressesFinding}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {canEdit && record && (
                            <>
                              <button type="button" className="rounded border border-violet/40 px-2 py-1 font-mono text-[0.625rem] uppercase tracking-wider text-violet-bright hover:bg-violet/15 focus-ring" onClick={() => setEditor({ entity: 'planOptions', initial: record as unknown as Record<string, unknown>, title: 'Edit plan option' })}>Edit</button>
                              <button type="button" className="rounded border border-violet/40 px-2 py-1 font-mono text-[0.625rem] uppercase tracking-wider text-violet-bright hover:bg-violet/15 focus-ring" onClick={() => { setDecisionDialog({ optionId: option.optionId, decision: data.decisions.find((decision) => decision.optionId === option.optionId) ?? null }) }}>
                                {option.decision ? 'Edit decision' : 'Record decision'}
                              </button>
                              <button type="button" className="rounded border border-violet/40 px-2 py-1 font-mono text-[0.625rem] uppercase tracking-wider text-violet-bright hover:bg-violet/15 focus-ring" onClick={() => setPendingDelete({ entity: 'planOptions', id: option.optionId, label: option.title })}>Delete</button>
                            </>
                          )}
                        </div>
                      </div>

                      <dl className="mt-4 grid gap-x-5 gap-y-3 border-t border-violet/20 pt-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <dt className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">Capital cost</dt>
                          <dd className="mt-0.5 font-mono text-ivory">{money(option.capitalCost)}</dd>
                        </div>
                        <div>
                          <dt className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">Annual cost / savings</dt>
                          <dd className="mt-0.5 font-mono text-ivory">{money(option.annualCost)} / {money(option.annualSavings)}</dd>
                        </div>
                        <div>
                          <dt className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">Net annual benefit</dt>
                          <dd className="mt-0.5 font-mono text-ivory">
                            {money(option.netAnnualBenefit)}
                            {option.netAnnualBenefit === null && <span className="block text-[0.625rem] text-ivory/40">Both cost and savings required</span>}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">Simple payback</dt>
                          <dd className="mt-0.5 font-mono text-ivory">{option.simplePaybackMonths === null ? 'Not calculated' : `${option.simplePaybackMonths.toFixed(1)} months`}</dd>
                        </div>
                        <div>
                          <dt className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">Seat effect</dt>
                          <dd className="mt-0.5 font-mono text-ivory">
                            {option.seatEffect === null ? 'Not recorded' : `${option.seatEffect} seats${option.seatEffectComplete ? '' : ' (partial)'}`}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">Disruption</dt>
                          <dd className="mt-0.5 font-mono text-ivory">{option.disruptionDays === null ? 'Not recorded' : `${option.disruptionDays} ${option.disruptionDays === 1 ? 'day' : 'days'}`}</dd>
                        </div>
                        <div>
                          <dt className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">Implementation</dt>
                          <dd className="mt-0.5 font-mono text-ivory">{option.implementationWeeks === null ? 'Not recorded' : `${option.implementationWeeks} ${option.implementationWeeks === 1 ? 'week' : 'weeks'}`}</dd>
                        </div>
                        <div>
                          <dt className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">Decision recorded</dt>
                          <dd className="mt-0.5 text-ivory">{option.decision?.decidedAt ? formatDateTime(option.decision.decidedAt) : 'No decision recorded'}</dd>
                        </div>
                      </dl>

                      <div className="mt-3 grid gap-3 border-t border-violet/20 pt-3 text-sm lg:grid-cols-3">
                        <div>
                          <p className="font-mono text-[0.5625rem] uppercase tracking-widest text-gold">Assumptions</p>
                          <p className="mt-1 text-xs leading-relaxed text-ivory/70">{option.assumptions || 'None recorded'}</p>
                        </div>
                        <div>
                          <p className="font-mono text-[0.5625rem] uppercase tracking-widest text-gold">Risks</p>
                          <p className="mt-1 text-xs leading-relaxed text-ivory/70">{option.risks || 'None recorded'}</p>
                        </div>
                        <div>
                          <p className="font-mono text-[0.5625rem] uppercase tracking-widest text-gold">Evidence</p>
                          <p className="mt-1 text-xs leading-relaxed text-ivory/70">{option.evidence || 'None recorded'}</p>
                        </div>
                      </div>

                      {option.decision && (option.decision.followUp || option.decision.notes) && (
                        <div className="mt-3 border-t border-violet/20 pt-3 text-xs text-ivory/60">
                          {option.decision.followUp && <p><span className="text-ivory/40">Follow-up:</span> {option.decision.followUp}</p>}
                          {option.decision.notes && <p className="mt-1"><span className="text-ivory/40">Notes:</span> {option.decision.notes}</p>}
                        </div>
                      )}
                    </article>
                  )
                })
              )}
              <p className="text-xs leading-relaxed text-ivory/45">
                No “best option” is chosen automatically. Costs, effects and evidence are recorded inputs; ranking them is a human
                decision. A missing value stays missing and is never treated as zero in payback or seat-effect maths.
              </p>
            </div>
          )}

          {tab === 'decisions' && (
            <div className="space-y-4">
              {data.decisions.length === 0 ? (
                <EmptyPanel title="No decisions recorded">Record a proposal for an option. An administrator then approves, rejects or defers it.</EmptyPanel>
              ) : (
                [...data.decisions]
                  .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt))
                  .map((decision) => {
                    const option = data.planOptions.find((item) => item.id === decision.optionId)
                    return (
                      <article key={decision.id} className="border border-violet/25 bg-ink/40 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge status={decision.status} />
                              {decision.ownerName && <Badge tone="violet">Owner: {decision.ownerName}</Badge>}
                            </div>
                            <h3 className="mt-2 font-heading text-lg text-ivory">{decision.title}</h3>
                            <p className="mt-0.5 text-xs text-ivory/50">
                              Option: {option?.title ?? 'Option no longer recorded'}
                            </p>
                            <p className="mt-1 text-xs text-ivory/45">
                              {decision.status === 'proposed'
                                ? `Proposed ${formatDateTime(decision.createdAt)}`
                                : `${titleCase(decision.status)} by ${decision.decidedByName ?? 'staff'} ${decision.decidedAt ? `on ${formatDateTime(decision.decidedAt)}` : 'with no recorded time'}`}
                            </p>
                            {decision.followUp && <p className="mt-2 text-sm text-ivory/70">Follow-up: {decision.followUp}</p>}
                            {decision.notes && <p className="mt-1 text-xs text-ivory/55">{decision.notes}</p>}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {canEdit && (
                              <button type="button" className="rounded border border-violet/40 px-2 py-1 font-mono text-[0.625rem] uppercase tracking-wider text-violet-bright hover:bg-violet/15 focus-ring" onClick={() => setDecisionDialog({ optionId: decision.optionId, decision })}>Edit</button>
                            )}
                            {isAdmin && decision.status === 'proposed' && (
                              <>
                                <button type="button" className="rounded border border-status-ok-dark/60 px-2 py-1 font-mono text-[0.625rem] uppercase tracking-wider text-status-ok-dark hover:bg-status-ok-dark/10 focus-ring" onClick={() => void updateStatus(decision, 'approved')}>Approve</button>
                                <button type="button" className="rounded border border-status-error-dark/60 px-2 py-1 font-mono text-[0.625rem] uppercase tracking-wider text-status-error-dark hover:bg-status-error-dark/10 focus-ring" onClick={() => void updateStatus(decision, 'rejected')}>Reject</button>
                                <button type="button" className="rounded border border-gold/60 px-2 py-1 font-mono text-[0.625rem] uppercase tracking-wider text-gold hover:bg-gold/10 focus-ring" onClick={() => void updateStatus(decision, 'deferred')}>Defer</button>
                              </>
                            )}
                          </div>
                        </div>
                      </article>
                    )
                  })
              )}
              <p className="text-xs leading-relaxed text-ivory/45">
                Approvals record the administrator and timestamp on the server. No AI process can approve, reject or
                defer a decision.
              </p>
            </div>
          )}

          {tab === 'report' && (
            <div className="space-y-6">
              {canEdit && (
                <Panel kicker="Ask your data" title="One question, one stored lookup">
                  {ai?.configured && !askError ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        if (askQuestion.trim()) void runLookup(askQuestion.trim())
                      }}
                      className="flex flex-wrap items-end gap-3"
                    >
                      <label className="min-w-0 flex-1 text-xs text-ivory/70">
                        <span className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Your question</span>
                        <input
                          value={askQuestion}
                          onChange={(event) => setAskQuestion(event.target.value)}
                          placeholder="e.g. Which rooms are over capacity?"
                          className="mt-1 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={askBusy || !askQuestion.trim()}
                        className="min-h-11 rounded-md bg-violet px-4 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 disabled:opacity-40 focus-ring"
                      >
                        {askBusy ? 'Looking up…' : 'Ask'}
                      </button>
                    </form>
                  ) : (
                    <div>
                      <p className="text-sm text-ivory/70">
                        {ai?.configured
                          ? 'The AI request failed. Use a button to run the same stored lookup without AI.'
                          : 'AI is not configured, so there is no question box. These buttons run the same stored lookups directly.'}{' '}
                        The server computes every answer from college records.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {LOOKUP_BUTTONS.map((button) => (
                          <button
                            key={button.id}
                            type="button"
                            disabled={askBusy}
                            onClick={() => void runLookup(button.label, button.id)}
                            className="min-h-11 rounded-md border border-violet/40 px-3 py-2 text-sm text-ivory/85 hover:bg-violet/15 disabled:opacity-40 focus-ring"
                          >
                            {button.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="mt-3 border-t border-violet/25 pt-3 text-xs leading-relaxed text-ivory/55">
                    The assistant never writes the answer and never sees the data: it only maps the question to one
                    fixed lookup, and the server computes the result from records.
                  </p>
                  {askError && <div className="mt-3"><Notice tone="danger">{askError}</Notice></div>}
                  {askResult && (
                    <div className="mt-4 border-t border-violet/25 pt-3">
                      {askResult.mapped ? (
                        <div>
                          <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">{askResult.label}</p>
                          <h4 className="mt-2 font-heading text-lg text-ivory">{askResult.title}</h4>
                          {(askResult.items ?? []).length === 0 ? (
                            <p className="mt-2 text-sm text-ivory/65">No records match this lookup right now.</p>
                          ) : (
                            <ul className="mt-2 divide-y divide-violet/15">
                              {(askResult.items ?? []).map((item, index) => (
                                <li key={index} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                                  <span className="text-sm font-medium text-ivory">{item.label}</span>
                                  <span className="flex min-w-0 items-center gap-2">
                                    <span className="text-xs text-ivory/60">{item.detail}</span>
                                    <Badge tone="outline">{item.tag}</Badge>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {askResult.note && <p className="mt-2 text-xs text-ivory/50">{askResult.note}</p>}
                        </div>
                      ) : (
                        <div>
                          <p className="text-sm font-semibold text-ivory">{askResult.message}</p>
                          <p className="mt-2 text-xs text-ivory/55">Questions I can answer:</p>
                          <ul className="mt-1 list-inside list-disc text-sm text-ivory/75">
                            {(askResult.supported ?? []).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </Panel>
              )}
              <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="space-y-4">
                  <p className="text-sm leading-relaxed text-ivory/65">
                    The report is built from recorded data and the same figures shown in this workspace. Every figure
                    carries a tag — Measured, Estimated, Illustrative or Missing — so a reader can see how it was
                    obtained. Missing values are written as Missing, never as 0.
                  </p>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-3 border-b border-violet/15 pb-1.5">
                      <dt className="text-ivory/55">College</dt><dd className="text-right text-ivory">{workspace.activeCollege.name}</dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-violet/15 pb-1.5">
                      <dt className="text-ivory/55">Prepared by</dt><dd className="text-right text-ivory">{session.user.displayName} ({ROLE_LABELS[role]})</dd>
                    </div>
                    <div className="flex justify-between gap-3 border-b border-violet/15 pb-1.5">
                      <dt className="text-ivory/55">Analysis time</dt><dd className="text-right text-ivory">{formatDateTime(analysis.asOf)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-ivory/55">Data source</dt><dd className="text-right text-ivory">{workspace.provenance.name}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-3">
                    <button type="button" onClick={() => void downloadReport()} className="rounded-md bg-violet px-4 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring">
                      Download Markdown report
                    </button>
                    <button type="button" onClick={() => void downloadCsv()} className="rounded-md border border-violet/40 px-4 py-2 text-sm text-ivory/80 hover:bg-violet/15 focus-ring">
                      Download CSV report
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const usedSummary = await ensureSummary()
                        setSummary(usedSummary)
                        setPrintView(true)
                        setTimeout(() => window.print(), 150)
                      }}
                      className="rounded-md border border-violet/40 px-4 py-2 text-sm text-ivory/80 hover:bg-violet/15 focus-ring"
                    >
                      Print view
                    </button>
                    {printView && (
                      <button type="button" onClick={() => setPrintView(false)} className="rounded-md border border-violet/40 px-4 py-2 text-sm text-ivory/80 hover:bg-violet/15 focus-ring">
                        Hide print view
                      </button>
                    )}
                  </div>
                  <Notice tone="info">
                    Exports are point-in-time. Later record changes are not reflected until a new export is generated.
                  </Notice>
                  {ai?.configured && canEdit && (
                    <div className="border border-gold/40 bg-gold/5 p-4">
                      <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Five-line summary</p>
                      <button
                        type="button"
                        onClick={() => {
                          setSummary(null)
                          void ensureSummary()
                        }}
                        disabled={summaryBusy}
                        className="mt-2 min-h-11 w-full rounded-md border border-gold/60 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/10 disabled:opacity-40 focus-ring"
                      >
                        {summaryBusy ? 'Writing…' : summary ? 'Write summary again (AI)' : 'Write summary (AI)'}
                      </button>
                      <p className="mt-2 text-xs leading-relaxed text-ivory/55">
                        The server sends the computed report facts through the number guard; any answer with a number
                        the facts do not support is rejected and the rule-based summary is used instead.
                      </p>
                      {summaryNote && <p className="mt-2 text-xs text-status-error-dark">{summaryNote}</p>}
                      {summary && (
                        <div className="mt-3 border-t border-violet/25 pt-3">
                          <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">{summary.label}</p>
                          <ul className="mt-2 space-y-1 text-sm leading-relaxed text-ivory/80">
                            {summary.lines.map((line, index) => (
                              <li key={index}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="space-y-4">
                  <div className="border border-violet/30 bg-ink/40 p-4">
                    <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Figure tags</p>
                    <ul className="mt-3 grid gap-2 text-xs leading-relaxed text-ivory/65 sm:grid-cols-2">
                      <li><Badge tone="ok">Measured</Badge> Recorded values or counts of records.</li>
                      <li><Badge tone="violet">Estimated</Badge> Calculated from a recorded tariff or an estimation step.</li>
                      <li><Badge tone="gold">Illustrative</Badge> An entered plan input, not a prediction.</li>
                      <li><Badge tone="outline">Missing</Badge> No record exists; nothing was assumed.</li>
                    </ul>
                  </div>
                  <div className="border border-violet/30 bg-ink/40 p-4">
                    <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Thresholds and sources</p>
                    {waterLimit ? (
                      <div className="mt-2 space-y-1 text-sm text-ivory/70">
                        <p>
                          Water limit: <span className="font-mono text-ivory">{waterLimit.limit} {waterLimit.unit}</span> per water meter per month.
                        </p>
                        <p>Type: <span className="text-ivory">{THRESHOLD_KIND_LABELS[waterLimit.kind]}</span></p>
                        <p>Source: <span className="text-ivory">{waterLimit.source}</span></p>
                        <p className="text-xs text-ivory/45">Recorded by {waterLimit.updatedByName} on {formatDateTime(waterLimit.updatedAt)}.</p>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-ivory/65">
                        No Water limit is recorded, so the Water needs row reports Not enough data. No default value is supplied.
                      </p>
                    )}
                    <p className="mt-3 border-t border-violet/20 pt-3 text-xs leading-relaxed text-ivory/55">
                      Lighting, Waste and Parking have no rule in this build that takes a limit, so no limit is recorded
                      for them.
                    </p>
                  </div>
                </div>
                <div className="min-w-0 xl:col-span-2">
                  <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Report preview</p>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words border border-violet/30 bg-ink p-4 font-mono text-[0.6875rem] leading-relaxed text-ivory/65">
                    {reportMarkdown}
                  </pre>
                </div>
              </div>
              {printView && (
                <PrintReport
                  workspace={workspace}
                  analysis={analysis}
                  preparedBy={session.user.displayName}
                  roleLabel={ROLE_LABELS[role]}
                  summary={summary}
                />
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
          description="Costs, effects and evidence are recorded inputs — not predictions."
          fields={optionFields()}
          initial={editor.initial}
          onSaved={refresh}
          size="xl"
        />
      )}

      {decisionDialog && (
        <DecisionDialog
          open
          onClose={() => setDecisionDialog(null)}
          onSaved={refresh}
          optionId={decisionDialog.optionId}
          decision={decisionDialog.decision}
          options={optionOptions}
          ownerOptions={ownerOptions}
          isAdmin={isAdmin}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this plan option?"
        message={pendingDelete ? `“${pendingDelete.label}” will be removed. Options with recorded decisions cannot be deleted.` : ''}
        onConfirm={remove}
        onClose={() => setPendingDelete(null)}
      />

      <Modal open={Boolean(explained)} onClose={() => setExplained(null)} title="Linked finding" description="What this finding is based on and what it cannot tell you." size="lg">
        {explained && <FindingExplainer finding={explained} methods={methodFor(explained)} />}
      </Modal>
    </div>
  )
}
