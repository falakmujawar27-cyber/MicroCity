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
import { EmptyPanel } from '../../components/ui/PageState'
import { Field, FormError, inputClass } from '../../components/ui/Form'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../auth/auth-context'
import { downloadFile } from '../../lib/download'
import { buildFindingsCsv, buildReportMarkdown, reportFileName } from '../../lib/reports'
import { formatCurrency, formatDateTime, titleCase } from '../../lib/format'
import { ROLE_LABELS } from '../../domain/types'
import type { Decision, DecisionStatus } from '../../domain/types'
import type { Finding as AnalysisFinding } from '../../domain/analysis'

type TabId = 'options' | 'decisions' | 'report' | 'ask'

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
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null)
  const [aiSummaryBusy, setAiSummaryBusy] = useState(false)
  const [question, setQuestion] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [askResult, setAskResult] = useState<{ kind: 'ai' | 'fallback' | 'none'; text: string } | null>(null)
  const [askError, setAskError] = useState<string | null>(null)

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

  const tabs = [
    { id: 'options', label: 'Options', count: data.planOptions.length },
    { id: 'decisions', label: 'Decisions', count: data.decisions.length },
    { id: 'report', label: 'Report & export' },
    { id: 'ask', label: 'Ask your data' },
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

  const downloadReport = () => {
    const markdown = buildReportMarkdown({
      workspace,
      analysis,
      preparedBy: session.user.displayName,
      roleLabel: ROLE_LABELS[role],
    })
    downloadFile(reportFileName(workspace.activeCollege.name, analysis.asOf), markdown, 'text/markdown;charset=utf-8')
  }

  const downloadCsv = () => {
    downloadFile(
      `microcity-findings-${analysis.asOf.slice(0, 10)}.csv`,
      `\uFEFF${buildFindingsCsv(analysis)}`,
      'text/csv;charset=utf-8',
    )
  }

  const runAiSummary = async () => {
    setAiSummaryBusy(true)
    setAiSummaryError(null)
    try {
      const result = await api.aiAssist({
        task: 'report-summary',
        facts: {
          college: workspace.activeCollege.name,
          generatedAt: analysis.asOf,
          findings: analysis.findingCounts,
          capacity: {
            assessedRooms: analysis.capacity.assessedRooms,
            unassessedRooms: analysis.capacity.unassessedRooms,
            shortages: analysis.capacity.shortages.length,
            overlaps: analysis.capacity.overlaps.length,
          },
          utilities: {
            electricity: analysis.utilities.totals.electricity.consumption,
            electricityUnit: analysis.utilities.totals.electricity.unit,
            water: analysis.utilities.totals.water.consumption,
            waterUnit: analysis.utilities.totals.water.unit,
            spikes: analysis.utilities.spikeCount,
            missingReadings: analysis.utilities.missingCount,
            resets: analysis.utilities.resetCount,
          },
          maintenance: {
            active: analysis.maintenance.activeCount,
            overdueInspections: analysis.maintenance.overdueInspectionCount,
            repeats: analysis.maintenance.repeats.length,
          },
          plan: {
            options: plan.options.length,
            approved: plan.approvalCounts.approved,
            undecided: plan.approvalCounts.none,
            unaddressedHighFindings: plan.unaddressedFindings.length,
          },
          topFindings: analysis.findings.slice(0, 8).map((finding) => ({
            severity: finding.severity,
            title: finding.title,
            summary: finding.summary,
            evidence: finding.evidence,
            limitations: finding.limitations,
          })),
          note: 'Summarise only the supplied computed facts. Do not invent causes, costs or recommendations.',
        },
      })
      if (result.ok && result.text) setAiSummary(result.text)
      else setAiSummaryError(result.error ?? 'No summary was returned.')
    } catch (err) {
      setAiSummaryError(err instanceof ApiError ? err.message : 'The assistant could not be reached.')
    } finally {
      setAiSummaryBusy(false)
    }
  }

  /**
   * Rule-based keyword search used when AI is unavailable or fails. It is
   * deliberately labelled "not AI" and only returns recorded facts.
   */
  const runFallback = (text: string) => {
    const stop = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'what', 'which', 'how', 'are', 'was', 'were', 'from', 'into', 'does', 'did', 'has', 'have', 'our', 'you', 'your', 'about', 'show', 'any'])
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !stop.has(token))
    if (tokens.length === 0) {
      setAskResult({ kind: 'none', text: 'Enter at least one keyword, for example “room 1.01”, “water spike” or “boiler”.' })
      return
    }
    const scored: { score: number; label: string; detail: string }[] = []
    const scoreText = (haystack: string) => tokens.reduce((total, token) => (haystack.toLowerCase().includes(token) ? total + 1 : total), 0)
    for (const finding of analysis.findings) {
      const score = scoreText([finding.title, finding.summary, ...finding.evidence].join(' '))
      if (score > 0) scored.push({ score, label: `[${titleCase(finding.severity)} finding] ${finding.title}`, detail: finding.summary })
    }
    for (const option of plan.options) {
      const score = scoreText([option.title, option.description, option.assumptions, option.risks].join(' '))
      if (score > 0) scored.push({ score, label: `[Plan option] ${option.title}`, detail: `${option.description} Net annual benefit: ${money(option.netAnnualBenefit)}; decision: ${option.decision ? titleCase(option.decision.status) : 'none recorded'}.` })
    }
    for (const room of analysis.capacity.rooms) {
      const score = scoreText([room.code, room.name, room.buildingName].join(' '))
      if (score > 0) scored.push({ score, label: `[Room] ${room.code} — ${room.name || room.buildingName}`, detail: `Score ${room.score ?? 'not available'}, status ${titleCase(room.status)}; peak demand ${room.expectedPeak ?? 'not recorded'} against capacity ${room.capacity ?? 'not recorded'}.` })
    }
    for (const meter of analysis.utilities.meters) {
      const score = scoreText([meter.meter.label, meter.buildingName, meter.meter.utility].join(' '))
      if (score > 0) scored.push({ score, label: `[Meter] ${meter.meter.label}`, detail: `Known consumption ${meter.knownConsumption} ${meter.meter.unit}; ${meter.missingReadings} missing reading(s); ${meter.spikes.length} flagged spike(s).` })
    }
    const top = scored.sort((a, b) => b.score - a.score).slice(0, 6)
    if (top.length === 0) {
      setAskResult({ kind: 'none', text: 'No recorded finding, option, room or meter matched those keywords. Try a room code, a meter name or a category such as “water”, “capacity” or “inspection”.' })
    } else {
      setAskResult({
        kind: 'fallback',
        text: top.map((entry) => `${entry.label}\n${entry.detail}`).join('\n\n'),
      })
    }
  }

  const ask = async () => {
    if (!question.trim()) return
    setAskBusy(true)
    setAskError(null)
    setAskResult(null)
    try {
      if (ai?.configured) {
        const result = await api.aiAssist({
          task: 'ask-data',
          question: question.trim(),
          facts: {
            college: workspace.activeCollege.name,
            generatedAt: analysis.asOf,
            findingCounts: analysis.findingCounts,
            topFindings: analysis.findings.slice(0, 20).map((finding) => ({
              severity: finding.severity,
              title: finding.title,
              summary: finding.summary,
              evidence: finding.evidence,
              limitations: finding.limitations,
            })),
            rooms: analysis.capacity.rooms.map((room) => ({
              code: room.code,
              name: room.name,
              building: room.buildingName,
              capacity: room.capacity,
              expectedPeak: room.expectedPeak,
              shortageSlots: room.shortageSlots,
              utilisation: room.averageUtilisation,
              score: room.score,
              status: room.status,
              missingInputs: room.missingInputs,
            })),
            meters: analysis.utilities.meters.map((meter) => ({
              label: meter.meter.label,
              utility: meter.meter.utility,
              unit: meter.meter.unit,
              knownConsumption: meter.knownConsumption,
              missingReadings: meter.missingReadings,
              spikes: meter.spikes,
              quality: meter.quality,
            })),
            planOptions: plan.options.map((option) => ({
              title: option.title,
              description: option.description,
              capitalCost: option.capitalCost,
              annualCost: option.annualCost,
              annualSavings: option.annualSavings,
              netAnnualBenefit: option.netAnnualBenefit,
              decision: option.decision?.status ?? 'none',
              assumptions: option.assumptions,
              risks: option.risks,
            })),
            note: 'Answer only from these facts. Missing values are unavailable, not zero. You cannot perform actions.',
          },
        })
        if (result.ok && result.text) setAskResult({ kind: 'ai', text: result.text })
        else {
          setAskError(result.error ?? 'The assistant did not return an answer.')
          runFallback(question)
        }
      } else {
        runFallback(question)
      }
    } catch (err) {
      setAskError(
        err instanceof ApiError
          ? `${err.message} A rule-based keyword search is shown instead.`
          : 'The assistant could not be reached. A rule-based keyword search is shown instead.',
      )
      runFallback(question)
    } finally {
      setAskBusy(false)
    }
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
    ? buildReportMarkdown({ workspace, analysis, preparedBy: session.user.displayName, roleLabel: ROLE_LABELS[role] })
    : ''

  return (
    <div>
      <PageHeading
        kicker="Module 05 — Plan & Report"
        title="Options, decisions and the record"
        description="Compare recorded options without an automatic recommendation, record who owns what, and export a report. Only an administrator can approve, reject or defer a decision."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Options recorded" value={data.planOptions.length} detail={`${plan.approvalCounts.approved} approved · ${plan.approvalCounts.proposed} proposed`} />
        <Stat label="Awaiting a decision" value={plan.approvalCounts.none} detail="Options with no recorded decision" tone={plan.approvalCounts.none > 0 ? 'high' : 'default'} />
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
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="space-y-4">
                <p className="text-sm leading-relaxed text-ivory/65">
                  The report is built from recorded data and the same figures shown in this workspace. It explains how
                  each figure was worked out, what is missing and what the records cannot show. Nothing is rounded into
                  false certainty.
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
                  <button type="button" onClick={downloadReport} className="rounded-md bg-violet px-4 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring">
                    Download Markdown report
                  </button>
                  <button type="button" onClick={downloadCsv} className="rounded-md border border-violet/40 px-4 py-2 text-sm text-ivory/80 hover:bg-violet/15 focus-ring">
                    Download findings CSV
                  </button>
                </div>
                <Notice tone="info">
                  Exports are point-in-time. Later record changes are not reflected until a new export is generated.
                </Notice>
              </div>
              <div className="border border-gold/50 bg-gold/5 p-4">
                <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Optional AI executive summary</p>
                {!ai?.configured ? (
                  <p className="mt-2 text-sm leading-relaxed text-ivory/60">
                    AI is not configured on this server. The full report is generated without it; no summary will be
                    written and no data leaves the server.
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-sm leading-relaxed text-ivory/60">
                      The configured provider receives only the figures and notes shown in the report — no raw records —
                      and returns a written summary. It cannot change the report.
                    </p>
                    <button
                      type="button"
                      onClick={() => void runAiSummary()}
                      disabled={aiSummaryBusy}
                      className="mt-3 rounded-md border border-gold/60 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/10 focus-ring disabled:opacity-50"
                    >
                      {aiSummaryBusy ? 'Generating…' : aiSummary ? 'Regenerate summary' : 'Generate summary (optional)'}
                    </button>
                    {aiSummaryError && <p className="mt-2 text-xs text-status-error-dark">{aiSummaryError}</p>}
                  </>
                )}
                {aiSummary && (
                  <div className="mt-4 border border-gold/50 bg-ink/60 p-3">
                    <p className="flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-widest text-gold">
                      <span aria-hidden="true">◆</span> AI-generated — please verify
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ivory/80">{aiSummary}</p>
                    <p className="mt-2 text-[0.625rem] text-ivory/40">Model: {ai?.model ?? 'configured provider'}</p>
                  </div>
                )}
              </div>
              <div className="xl:col-span-2">
                <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Report preview</p>
                <pre className="mt-2 max-h-96 overflow-auto border border-violet/30 bg-ink p-4 font-mono text-[0.6875rem] leading-relaxed text-ivory/65">
                  {reportMarkdown}
                </pre>
              </div>
            </div>
          )}

          {tab === 'ask' && (
            <div className="space-y-5">
              <div>
                <p className="text-sm leading-relaxed text-ivory/65">
                  Ask about the findings, options and recorded observations. {ai?.configured
                    ? 'The configured provider answers only from the facts supplied with the question.'
                    : 'AI is not configured, so a rule-based keyword search is used instead. It is not AI.'}
                </p>
                <label htmlFor="ask-question" className="mt-4 block font-mono text-[0.625rem] uppercase tracking-widest text-gold">
                  Your question
                </label>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="ask-question"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="e.g. Which rooms have a capacity shortfall?"
                    className={inputClass}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void ask()
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void ask()}
                    disabled={askBusy || !question.trim()}
                    className="shrink-0 rounded-md bg-violet px-4 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:opacity-50"
                  >
                    {askBusy ? 'Asking…' : 'Ask'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-ivory/45">
                  Examples: “water spikes”, “room 1.01”, “overdue inspections”, “boiler”, “what is unaddressed?”
                </p>
              </div>

              {askError && <Notice tone="warning">{askError}</Notice>}

              {askResult && (
                <div className={`border p-4 ${askResult.kind === 'ai' ? 'border-gold/60 bg-gold/5' : 'border-violet/40 bg-ink/60'}`}>
                  <p className={`flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-widest ${askResult.kind === 'ai' ? 'text-gold' : 'text-violet-bright'}`}>
                    <span aria-hidden="true">{askResult.kind === 'ai' ? '◆' : '■'}</span>
                    {askResult.kind === 'ai'
                      ? 'AI-generated — please verify'
                      : askResult.kind === 'fallback'
                        ? 'Rule-based keyword search — not AI'
                        : 'No recorded match'}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ivory/80">{askResult.text}</p>
                  {askResult.kind === 'ai' && (
                    <p className="mt-2 text-[0.625rem] text-ivory/40">
                      Model: {ai?.model ?? 'configured provider'} · cannot change records or approve decisions
                    </p>
                  )}
                  {askResult.kind === 'fallback' && (
                    <p className="mt-2 text-[0.625rem] text-ivory/40">
                      Matched recorded text only. No generation, inference or advice is involved.
                    </p>
                  )}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Panel kicker="Grounding" title="What the assistant can see">
                  <ul className="space-y-2 text-xs leading-relaxed text-ivory/60">
                    <li>• Finding counts, supporting evidence and limitations.</li>
                    <li>• Room capacity, scores and missing inputs.</li>
                    <li>• Meter consumption, missing readings and flags.</li>
                    <li>• Recorded plan options, costs, assumptions and decisions.</li>
                  </ul>
                </Panel>
                <Panel kicker="Guardrails" title="What it cannot do">
                  <ul className="space-y-2 text-xs leading-relaxed text-ivory/60">
                    <li>• Create, edit or delete any record.</li>
                    <li>• Approve, reject or defer a decision.</li>
                    <li>• Recalculate a score or invent a missing value.</li>
                    <li>• Access another college's data.</li>
                  </ul>
                </Panel>
              </div>
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
