/**
 * Plan option comparison and decision traceability.
 *
 * The analysis only presents supplied costs, effects, assumptions and risks.
 * It does not invent savings, rank options as a recommendation, or calculate
 * a payback unless both the capital cost and a positive net annual benefit are
 * recorded. Decisions are shown with their recorded status, owner and time.
 */
import type { Decision, DecisionStatus, PlanOption } from '../types.ts'
import type { Finding, FindingSeverity } from './types.ts'

export interface OptionDecision {
  decisionId: string
  title: string
  status: DecisionStatus
  decidedAt: string | null
  decidedByName: string | null
  ownerUserId: string | null
  ownerName: string | null
  followUp: string
  notes: string
}

export interface OptionAnalysis {
  optionId: string
  title: string
  optionType: PlanOption['optionType']
  description: string
  addressesFinding: string
  finding: Finding | null
  findingSeverity: FindingSeverity | null
  capitalCost: number | null
  annualCost: number | null
  annualSavings: number | null
  netAnnualBenefit: number | null
  simplePaybackMonths: number | null
  paybackNote: string
  seatEffect: number | null
  seatEffectComplete: boolean
  disruptionDays: number | null
  implementationWeeks: number | null
  assumptions: string
  risks: string
  evidence: string
  missingNumericFields: string[]
  recordedNumericFields: number
  numericFieldCount: number
  decision: OptionDecision | null
  approvalState: DecisionStatus | 'none'
}

export interface PlanAnalysis {
  options: OptionAnalysis[]
  matchedFindingIds: string[]
  unaddressedFindings: Finding[]
  approvalCounts: Record<DecisionStatus | 'none', number>
  findings: Finding[]
  methods: string[]
}

const METHODS = [
  'Option facts are copied from the recorded option; MicroCity does not predict costs, savings or effects.',
  'Net annual benefit is calculated only when both annual cost and annual savings are recorded, as annual savings minus annual cost.',
  'Simple payback is calculated only when capital cost and a positive net annual benefit are recorded: capital cost / net annual benefit × 12. It excludes discount rates, inflation and benefits not recorded as annual savings.',
  'Seat effect adds recorded capacity gain and recorded demand reduction. If only one is recorded it is shown with a partial-evidence flag; missing values are never treated as zero.',
  'Options are listed in their recorded order. No automatic "best option" is produced: costs, evidence quality, constraints and risk tolerance are human judgements.',
  'Only an administrator can record an approved, rejected or deferred decision. Every decision retains its actor, time, owner and follow-up text.',
]

const NUMERIC_FIELDS: { key: keyof PlanOption; label: string }[] = [
  { key: 'capitalCost', label: 'Capital cost' },
  { key: 'annualCost', label: 'Annual cost' },
  { key: 'annualSavings', label: 'Annual savings' },
  { key: 'capacityGainSeats', label: 'Capacity gain' },
  { key: 'demandReducedSeats', label: 'Demand reduction' },
  { key: 'disruptionDays', label: 'Disruption days' },
  { key: 'implementationWeeks', label: 'Implementation weeks' },
]

function decisionFor(option: PlanOption, decisions: Decision[]): OptionDecision | null {
  const matching = decisions
    .filter((decision) => decision.optionId === option.id)
    .sort((a, b) => {
      const aTime = Date.parse(a.decidedAt ?? a.createdAt)
      const bTime = Date.parse(b.decidedAt ?? b.createdAt)
      return bTime - aTime
    })
  const latest = matching[0]
  if (!latest) return null
  return {
    decisionId: latest.id,
    title: latest.title,
    status: latest.status,
    decidedAt: latest.decidedAt,
    decidedByName: latest.decidedByName ?? null,
    ownerUserId: latest.ownerUserId,
    ownerName: latest.ownerName ?? null,
    followUp: latest.followUp,
    notes: latest.notes,
  }
}

export function analysePlan(options: PlanOption[], decisions: Decision[], allFindings: Finding[]): PlanAnalysis {
  const findingsById = new Map(allFindings.map((finding) => [finding.id, finding]))
  const findings: Finding[] = []
  const analyzed: OptionAnalysis[] = []
  const matchedFindingIds: string[] = []

  for (const option of options) {
    const finding = findingsById.get(option.addressesFinding) ?? null
    if (finding) matchedFindingIds.push(finding.id)

    const missingNumericFields = NUMERIC_FIELDS.filter((field) => option[field.key] === null || option[field.key] === undefined).map(
      (field) => field.label,
    )
    const netAnnualBenefit =
      option.annualCost !== null && option.annualSavings !== null ? option.annualSavings - option.annualCost : null
    const simplePaybackMonths =
      option.capitalCost !== null && netAnnualBenefit !== null && netAnnualBenefit > 0
        ? Math.round(((option.capitalCost / netAnnualBenefit) * 12 + Number.EPSILON) * 10) / 10
        : null
    const paybackNote =
      simplePaybackMonths !== null
        ? 'Simple payback from recorded annual figures; no discounting.'
        : option.annualSavings === null
          ? 'Annual savings are not recorded, so payback cannot be calculated.'
          : option.annualCost === null
            ? 'Annual cost is not recorded, so payback cannot be calculated.'
            : netAnnualBenefit !== null && netAnnualBenefit <= 0
              ? 'Recorded annual cost is equal to or greater than recorded annual savings; there is no positive payback.'
              : option.capitalCost === null
                ? 'Capital cost is not recorded, so payback cannot be calculated.'
                : 'Payback is not available from the recorded fields.'

    const seatParts = [option.capacityGainSeats, option.demandReducedSeats].filter(
      (value): value is number => value !== null && value !== undefined,
    )
    const seatEffect = seatParts.length > 0 ? seatParts.reduce((sum, value) => sum + value, 0) : null
    const seatEffectComplete = option.capacityGainSeats !== null && option.demandReducedSeats !== null
    const decision = decisionFor(option, decisions)

    analyzed.push({
      optionId: option.id,
      title: option.title,
      optionType: option.optionType,
      description: option.description,
      addressesFinding: option.addressesFinding,
      finding,
      findingSeverity: finding?.severity ?? null,
      capitalCost: option.capitalCost,
      annualCost: option.annualCost,
      annualSavings: option.annualSavings,
      netAnnualBenefit,
      simplePaybackMonths,
      paybackNote,
      seatEffect,
      seatEffectComplete,
      disruptionDays: option.disruptionDays,
      implementationWeeks: option.implementationWeeks,
      assumptions: option.assumptions,
      risks: option.risks,
      evidence: option.evidence,
      missingNumericFields,
      recordedNumericFields: NUMERIC_FIELDS.length - missingNumericFields.length,
      numericFieldCount: NUMERIC_FIELDS.length,
      decision,
      approvalState: decision?.status ?? 'none',
    })

    if (!finding && option.addressesFinding) {
      findings.push({
        id: `plan-address-missing-${option.id}`,
        module: 'plan',
        severity: 'low',
        title: `Plan option references a finding that is not current: ${option.title}`,
        summary:
          `The option records "${option.addressesFinding}" as its target, but no current finding has that identifier. ` +
          'The link may be out of date after data changes.',
        evidence: [`Recorded target: ${option.addressesFinding}`, `Option: ${option.id}`],
        limitations: ['The target string is not validated against the original source material; it is only checked against current computed findings.'],
        subjectIds: [option.id],
        facts: { optionId: option.id, addressesFinding: option.addressesFinding },
      })
    }
    if (decision && decision.status === 'approved' && !decision.ownerUserId) {
      findings.push({
        id: `plan-owner-${decision.decisionId}`,
        module: 'plan',
        severity: 'medium',
        title: `Approved option has no owner: ${option.title}`,
        summary: 'The decision is approved but no accountable owner is recorded for the follow-up.',
        evidence: [
          `Decision: ${decision.title}`,
          `Approved: ${decision.decidedAt ?? 'time not recorded'}`,
          `Follow-up: ${decision.followUp || 'none recorded'}`,
        ],
        limitations: ['The decision record is authoritative for approval; ownership must be assigned by an administrator.'],
        subjectIds: [option.id, decision.decisionId],
        facts: { optionId: option.id, decisionId: decision.decisionId, status: decision.status },
      })
    }
  }

  const addressed = new Set(matchedFindingIds)
  const unaddressedFindings = allFindings.filter(
    (finding) =>
      (finding.severity === 'critical' || finding.severity === 'high') &&
      !addressed.has(finding.id) &&
      finding.module !== 'plan',
  )

  for (const finding of unaddressedFindings) {
    findings.push({
      id: `plan-unaddressed-${finding.id}`,
      module: 'plan',
      severity: finding.severity === 'critical' ? 'critical' : 'high',
      title: `No plan option addresses: ${finding.title}`,
      summary:
        `A ${finding.severity === 'critical' ? 'critical' : 'high'}-severity issue from the ${finding.module} module has no linked option. ` +
        'A response may be required or the finding may be accepted with a recorded rationale.',
      evidence: finding.evidence.slice(0, 4),
      limitations: [
        'Absence of a linked option does not mean no action is being taken outside MicroCity.',
        'Options link to findings by identifier; a human should confirm the intended coverage.',
      ],
      subjectIds: [finding.id, ...finding.subjectIds],
      facts: {
        sourceFindingId: finding.id,
        sourceModule: finding.module,
        sourceSeverity: finding.severity,
        sourceTitle: finding.title,
        sourceSummary: finding.summary,
      },
    })
  }

  const undecided = analyzed.filter((option) => option.approvalState === 'none')
  if (undecided.length > 0) {
    findings.push({
      id: 'plan-undecided',
      module: 'plan',
      severity: 'info',
      title: `${undecided.length} plan option${undecided.length === 1 ? '' : 's'} without a recorded decision`,
      summary: undecided.map((option) => option.title).join('; '),
      evidence: undecided.map((option) => `${option.title} (${option.optionId})`),
      limitations: ['A decision may exist outside MicroCity; only recorded decisions are counted.'],
      subjectIds: undecided.map((option) => option.optionId),
      facts: { optionIds: undecided.map((option) => option.optionId), titles: undecided.map((option) => option.title) },
    })
  }

  for (const option of analyzed) {
    if (option.approvalState === 'approved' && option.netAnnualBenefit !== null && option.netAnnualBenefit <= 0) {
      findings.push({
        id: `plan-negative-${option.optionId}`,
        module: 'plan',
        severity: 'info',
        title: `Approved option has no positive net annual benefit: ${option.title}`,
        summary:
          `Recorded annual cost (${option.annualCost}) is equal to or greater than recorded annual savings (${option.annualSavings}). ` +
          'The decision may still be justified by non-financial effects or risk reduction, which should be recorded.',
        evidence: [
          `Annual cost: ${option.annualCost ?? 'not recorded'}`,
          `Annual savings: ${option.annualSavings ?? 'not recorded'}`,
          `Net annual benefit: ${option.netAnnualBenefit}`,
        ],
        limitations: ['Only recorded annual figures are compared; one-off benefits, avoided costs and risk reduction are not monetised.'],
        subjectIds: [option.optionId],
        facts: {
          optionId: option.optionId,
          annualCost: option.annualCost,
          annualSavings: option.annualSavings,
          netAnnualBenefit: option.netAnnualBenefit,
        },
      })
    }
  }

  const approvalCounts: Record<DecisionStatus | 'none', number> = {
    approved: 0,
    proposed: 0,
    rejected: 0,
    deferred: 0,
    none: 0,
  }
  for (const option of analyzed) approvalCounts[option.approvalState] += 1

  return {
    options: analyzed,
    matchedFindingIds,
    unaddressedFindings,
    approvalCounts,
    findings,
    methods: METHODS,
  }
}
