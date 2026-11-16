import type { AnalysisBundle, MeterAnalysis } from '../domain/analysis/index.ts'
import {
  isCriticalGapItem,
  NEEDS_THRESHOLDS,
  NEARBY_RULE,
  NEARBY_RULE_LABEL,
} from '../domain/analysis/index.ts'
import { THRESHOLD_KIND_LABELS } from '../domain/types.ts'
import type { WorkspacePayload } from '../domain/types.ts'
import { formatCurrency, formatDate, formatDateTime, formatNumber, titleCase } from './format.ts'

export type FigureTag = 'Measured' | 'Estimated' | 'Illustrative' | 'Missing'

/**
 * Weakest-basis rule (Phase F carry-over): the tag of a total takes the
 * weakest basis of the records behind it — Illustrative is weaker than
 * Estimated, which is weaker than Measured. No records means Missing.
 */
export function weakestTag(bases: FigureTag[]): FigureTag {
  const strength: Record<FigureTag, number> = { Missing: 0, Illustrative: 1, Estimated: 2, Measured: 3 }
  if (bases.length === 0) return 'Missing'
  return bases.reduce((weakest, tag) => (strength[tag] < strength[weakest] ? tag : weakest), 'Measured' as FigureTag)
}

export function figureTag(value: FigureTag): string {
  return `[${value}]`
}

function figure(value: number | null, tag: FigureTag = 'Measured', unit = ''): string {
  return value === null ? 'Missing [Missing]' : `${formatNumber(value)}${unit ? ` ${unit}` : ''} ${figureTag(tag)}`
}

function meterFigureTag(meter: MeterAnalysis): FigureTag {
  if (meter.knownPeriods === 0) return 'Missing'
  return meter.measurementType === 'estimated' ? 'Estimated' : 'Measured'
}

/** The row's own record tag, so imported and illustrative rows stay distinguishable. */
function recordTag(basis: string | null | undefined): FigureTag {
  if (basis === 'measured') return 'Measured'
  if (basis === 'estimated') return 'Estimated'
  if (basis === 'illustrative') return 'Illustrative'
  return 'Missing'
}

export interface ReportInput {
  workspace: WorkspacePayload
  analysis: AnalysisBundle
  preparedBy: string
  roleLabel: string
}

export interface ReportSummary {
  /** 'AI-generated, please verify' or 'Rule-based explanation'. */
  label: string
  source: 'ai' | 'rule'
  lines: string[]
}

/**
 * The computed facts behind the report, used for both the AI summary prompt
 * and its number guard. Deterministic values only; null means not recorded.
 */
export function buildReportFacts({ workspace, analysis }: ReportInput): Record<string, unknown> {
  const c = analysis.capacity
  const u = analysis.utilities
  const m = analysis.maintenance
  const p = analysis.plan
  const data = workspace.dataset
  const campusOpen = data.complaints.filter((row) => row.status === 'open' || row.status === 'in_progress').length
  const publicOpen = data.urbanIssues.filter((row) => row.status === 'reported' || row.status === 'in_progress').length
  const critical = analysis.gaps.filter(isCriticalGapItem).length
  const waiting = p.options.filter((option) => option.approvalState === 'none' || option.approvalState === 'proposed').length
  const utilityFacts = (utility: 'electricity' | 'water') => {
    const total = u.totals[utility]
    const meters = u.meters.filter((meter) => meter.meter.utility === utility)
    return {
      unit: total.unit ?? null,
      consumption: meters.some((meter) => meter.knownPeriods > 0) ? total.consumption : null,
      missingReadings: u.meters.filter((meter) => meter.meter.utility === utility).reduce((sum, meter) => sum + meter.missingReadings, 0),
      spikes: meters.reduce((sum, meter) => sum + meter.spikes.length, 0),
      resets: meters.reduce((sum, meter) => sum + meter.resets.length, 0),
      estimatedCost: total.cost,
      costCurrency: total.currency ?? null,
    }
  }
  return {
    college: workspace.activeCollege.name,
    criticalGapItems: critical,
    diagnosticFindings: analysis.findingCounts,
    openCampusIssues: campusOpen,
    openPublicIssues: publicOpen,
    decisionsWaiting: waiting,
    rooms: {
      assessed: c.assessedRooms,
      unassessed: c.unassessedRooms,
      shortageSlots: c.shortages.length,
      overlaps: c.overlaps.length,
    },
    electricity: utilityFacts('electricity'),
    water: utilityFacts('water'),
    maintenance: {
      activeRanked: m.activeCount,
      resolvedOrClosed: m.closedCount,
      repeatGroups: m.repeats.length + m.publicRepeats.length,
      overdueInspections: m.overdueInspectionCount,
      dueSoonInspections: m.dueSoonInspectionCount,
    },
    plan: {
      options: p.options.length,
      approved: p.approvalCounts.approved,
      proposed: p.approvalCounts.proposed,
      noDecision: p.approvalCounts.none,
    },
    dataset: {
      buildings: data.buildings.length,
      rooms: data.rooms.length,
      timetableSlots: data.timetableSlots.length,
      assets: data.assets.length,
      utilityReadings: data.utilityReadings.length,
    },
  }
}

/** Deterministic five-line summary, always available and labelled as not AI. */
export function buildRuleBasedSummary(input: ReportInput): ReportSummary {
  const facts = buildReportFacts(input) as {
    criticalGapItems: number
    openCampusIssues: number
    openPublicIssues: number
    decisionsWaiting: number
    electricity: { missingReadings: number; resets: number; spikes: number }
    water: { missingReadings: number; resets: number }
    maintenance: { activeRanked: number; overdueInspections: number }
    plan: { options: number }
  }
  const u = facts.electricity
  const w = facts.water
  const mz = facts.maintenance
  const pz = facts.plan
  return {
    label: 'Rule-based explanation',
    source: 'rule',
    lines: [
      `${facts.criticalGapItems} critical gap item${facts.criticalGapItems === 1 ? '' : 's'} need attention first.`,
      `Open issues: ${facts.openCampusIssues} campus and ${facts.openPublicIssues} public report${facts.openCampusIssues + facts.openPublicIssues === 1 ? '' : 's'} are not resolved yet.`,
      `Utilities: ${u.spikes} flagged spike${u.spikes === 1 ? '' : 's'}, ${u.missingReadings + w.missingReadings} missing reading${u.missingReadings + w.missingReadings === 1 ? '' : 's'} and ${u.resets + w.resets} meter reset${u.resets + w.resets === 1 ? '' : 's'} need review.`,
      `Maintenance: ${mz.activeRanked} active complaint${mz.activeRanked === 1 ? '' : 's'} ranked and ${mz.overdueInspections} inspection${mz.overdueInspections === 1 ? '' : 's'} overdue.`,
      `Plan: ${pz.options} option${pz.options === 1 ? '' : 's'} recorded and ${facts.decisionsWaiting} decision${facts.decisionsWaiting === 1 ? '' : 's'} still waiting.`,
    ],
  }
}

function mdEscape(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ')
}

function money(value: number | null, currency: string | null = 'INR', tag: FigureTag = 'Illustrative'): string {
  return value === null ? 'Missing [Missing]' : `${formatCurrency(value, currency ?? 'INR')} ${figureTag(tag)}`
}

export interface ReportInputWithSummary extends ReportInput {
  /** Omit for the rule-based summary; pass an AI summary once accepted. */
  summary?: ReportSummary | null
}

export function buildReportMarkdown(input: ReportInputWithSummary): string {
  const summary = input.summary === undefined || input.summary === null ? buildRuleBasedSummary(input) : input.summary
  const workspace = input.workspace
  const analysis = input.analysis
  const preparedBy = input.preparedBy
  const roleLabel = input.roleLabel
  const college = workspace.activeCollege.name
  const provenance = workspace.provenance
  const c = analysis.capacity
  const u = analysis.utilities
  const m = analysis.maintenance
  const p = analysis.plan
  const data = workspace.dataset
  const lines: string[] = []
  const campusOpen = data.complaints.filter((row) => row.status === 'open' || row.status === 'in_progress')
  const publicOpen = data.urbanIssues.filter((row) => row.status === 'reported' || row.status === 'in_progress')
  const waiting = p.options.filter((option) => option.approvalState === 'none' || option.approvalState === 'proposed')
  const critical = analysis.gaps.filter(isCriticalGapItem)
  const basisById = new Map<string, string | null | undefined>()
  for (const record of [...data.rooms, ...data.buildings, ...data.assets, ...data.complaints, ...data.planOptions]) {
    basisById.set(record.id, record.basis)
  }
  const rowTag = (ids: string[]): FigureTag => {
    const tags = ids.map((id) => recordTag(basisById.get(id))).filter((tag) => tag !== 'Missing')
    return tags.length > 0 ? weakestTag(tags) : 'Missing'
  }

  lines.push(`# MicroCity infrastructure report — ${mdEscape(college)}`, '')
  lines.push(`**Generated:** ${formatDateTime(analysis.asOf)}  `)
  lines.push(`**Prepared by:** ${mdEscape(preparedBy)} (${roleLabel})  `)
  lines.push(`**College scope:** ${mdEscape(college)}  `)
  lines.push(`**Data source:** ${mdEscape(provenance.name)} — ${provenance.synthetic ? 'SYNTHETIC base data' : 'illustrative pilot data'}, ${mdEscape(provenance.license)}`, '')
  lines.push('> This report uses the records visible to the signed-in account. It is not an engineering survey, statutory inspection or financial forecast. Missing values remain missing and are not treated as zero.')
  if (provenance.notes) lines.push(`> ${mdEscape(provenance.notes)}`)
  lines.push('', '**Figure tags:** Measured — recorded values or counts of records; Estimated — calculated scores, ratios, estimates or tariff-based costs; Illustrative — plan inputs or project-assumption parameters, not predictions; Missing — unavailable, with nothing assumed. Tags do not turn synthetic records into real measurements. Dates, identifiers and section numbers are not measurement figures.', '')

  lines.push('## Plain-language summary', '')
  lines.push(`**${summary.label}**`, '')
  for (const line of summary.lines) lines.push(line)
  if (summary.source === 'ai') {
    lines.push('', '*Generated from the computed report facts; verify before use. Code calculated every number.*')
  }
  lines.push('')

  const utilitySummary = (utility: 'electricity' | 'water') => {
    const total = u.totals[utility]
    const meters = u.meters.filter((meter) => meter.meter.utility === utility)
    const known = meters.some((meter) => meter.knownPeriods > 0)
    // The total takes the weakest basis of the meters behind it (Phase F).
    const tag = weakestTag(
      meters.map((meter) => meterFigureTag(meter)).filter((meterTag) => meterTag !== 'Missing'),
    )
    const value = figure(known ? total.consumption : null, tag, total.unit ?? '')
    const cost = total.cost === null
      ? 'cost not calculated — no matching tariff rate entered [Missing]'
      : `estimated cost ${money(total.cost, total.currency, 'Estimated')}${total.costComplete ? '' : ' (partial)'}`
    return `${value}${total.missingReadings > 0 ? ' (lower bound; missing readings excluded)' : ''}; ${cost}`
  }

  lines.push('## 1. Summary', '')
  lines.push(`- Critical gaps: ${figure(critical.length)} distinct critical item(s). A gap and its no-plan finding count once; nearby gaps count once per type.`)
  lines.push(`- Open issues: ${figure(campusOpen.length + publicOpen.length)} — campus Open or In progress plus public Reported or In progress.`)
  lines.push(`- Decisions waiting: ${figure(waiting.length)} — plan options with no decision or a proposal awaiting a decision.`)
  lines.push(`- Diagnostic findings by severity: ${figure(analysis.findingCounts.critical)} critical, ${figure(analysis.findingCounts.high)} high, ${figure(analysis.findingCounts.medium)} medium, ${figure(analysis.findingCounts.low)} low, ${figure(analysis.findingCounts.info)} informational. These are separately listed diagnostic findings, not the distinct critical item count above.`)
  lines.push(`- Rooms assessed: ${figure(c.assessedRooms)}; unassessed: ${figure(c.unassessedRooms)}; ${figure(c.shortages.length)} shortfall slot(s); ${figure(c.overlaps.length)} overlap(s).`)
  lines.push(`- Electricity recorded consumption: ${utilitySummary('electricity')}.`)
  lines.push(`- Water recorded consumption: ${utilitySummary('water')}.`)
  lines.push(`- Utility quality: ${figure(u.missingCount)} missing reading(s), ${figure(u.spikeCount)} flagged spike(s), ${figure(u.resetCount)} meter reset(s).`)
  lines.push(`- Active complaints ranked: ${figure(m.activeCount)}; resolved or closed: ${figure(m.closedCount)}; repeat groups: ${figure(m.repeats.length + m.publicRepeats.length)}.`)
  lines.push(`- Inspections: ${figure(m.overdueInspectionCount)} overdue, ${figure(m.dueSoonInspectionCount)} due soon.`)
  lines.push(`- Plan options: ${figure(p.options.length)}; ${figure(p.approvalCounts.approved)} approved, ${figure(p.approvalCounts.proposed)} proposed, ${figure(p.approvalCounts.none)} with no decision.`, '')

  lines.push('### Records behind the Overview counts', '')
  lines.push('| Count | Value | Basis | Matching record IDs / computed finding IDs |')
  lines.push('| --- | --- | --- | --- |')
  lines.push(`| Critical gaps | ${figure(critical.length)} | ${figureTag(rowTag(critical.flatMap((row) => row.subjectIds)))} | ${critical.map((row) => `${mdEscape(row.id)}${row.noPlanYet ? ' (no plan yet)' : ''}`).join(', ') || 'None'} |`)
  lines.push(`| Open campus issues | ${figure(campusOpen.length)} | ${figureTag(rowTag(campusOpen.map((row) => row.id)))} | ${campusOpen.map((row) => mdEscape(row.id)).join(', ') || 'None'} |`)
  lines.push(`| Open public issues | ${figure(publicOpen.length)} | ${figureTag(rowTag(publicOpen.map((row) => row.id)))} | ${publicOpen.map((row) => mdEscape(row.id)).join(', ') || 'None'} |`)
  lines.push(`| Decisions waiting | ${figure(waiting.length)} | ${figureTag(rowTag(waiting.map((row) => row.optionId)))} | ${waiting.map((row) => `${mdEscape(row.optionId)} (${row.approvalState})`).join(', ') || 'None'} |`, '')

  lines.push('## 2. Room capacity and needs', '')
  if (c.rooms.length === 0) {
    lines.push('No rooms are recorded for this college. [Missing]')
  } else {
    lines.push('| Room | Building | Capacity | Peak enrolled | Shortage slots | Utilisation | Needs score | Status | Basis |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const room of c.rooms) {
      lines.push(`| ${mdEscape(room.code)}${room.name ? ` — ${mdEscape(room.name)}` : ''} | ${mdEscape(room.buildingName)} | ${figure(room.capacity)} | ${figure(room.expectedPeak)} | ${figure(room.shortageSlots)} | ${figure(room.averageUtilisation === null ? null : room.averageUtilisation * 100, 'Estimated', '%')} | ${figure(room.score, 'Estimated')} | ${titleCase(room.status)} | ${figureTag(rowTag([room.roomId]))} |`)
    }
    lines.push('', '### Recorded capacity shortfalls', '')
    lines.push('| Room | Activity | Starts | Enrolled | Capacity | Shortfall |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const shortage of c.shortages) {
      lines.push(`| ${mdEscape(shortage.roomCode)} | ${mdEscape(shortage.activity)} | ${formatDateTime(shortage.startsAt)} | ${figure(shortage.expectedAttendance)} | ${figure(shortage.capacity)} | ${figure(shortage.shortageSeats, 'Estimated')} |`)
    }
    if (c.overlaps.length > 0) {
      lines.push('', '### Timetable overlaps', '')
      for (const overlap of c.overlaps) {
        lines.push(`- ${mdEscape(overlap.roomCode)}: ${figure(overlap.minutes, 'Estimated', 'minutes')} overlap between “${mdEscape(overlap.a.activity)}” and “${mdEscape(overlap.b.activity)}”.`)
      }
    }
  }
  lines.push('', '**Rooms rule and source:** the category takes the highest scored room status. Enrolled demand is the largest expected class in that same room; average present only feeds occupancy. Attendance is never summed across classes in the displayed comparison. The Needs Score combines capacity shortfall, occupancy, condition, unresolved maintenance and repeats. Source: MicroCity existing Needs Score rule — Project assumption, not a published norm.')
  lines.push(`Rooms has no administrator-entered limit. Its fixed score bands are Stressed at ${figure(NEEDS_THRESHOLDS.stressed, 'Illustrative', 'points')} and Critical at ${figure(NEEDS_THRESHOLDS.critical, 'Illustrative', 'points')}; missing required inputs remain unscored.`, '')

  lines.push('### Needs Score components and sources', '')
  lines.push('All component weights, cut-offs and severity points below are MicroCity project assumptions, not published norms. Evidence comes from this college’s room, timetable/attendance and room-linked complaint records. The formula has not been changed.')
  lines.push('| Component | Maximum points | Rule and input source |')
  lines.push('| --- | --- | --- |')
  lines.push('| Capacity shortfall | 40 [Illustrative] | From recorded seat capacity and the worst expected-attendance shortfall. For positive capacity and a positive shortage: 20 + min(20, round(20 × shortage / capacity)) [Illustrative rule parameters]; otherwise zero when comparable evidence exists. Missing comparable evidence stays missing. |')
  lines.push('| Observed occupancy pressure | 20 [Illustrative] | Mean actual attendance / seats across recorded sessions; min(20, round(20 × max(0, mean utilisation − 0.85) / 0.15)) [Illustrative rule parameters]. Positive capacity and actual attendance are required. Enrolled demand is not attendance. |')
  lines.push('| Room condition | 15 [Illustrative] | Room record: Good 0 [Illustrative], Fair 8 [Illustrative], Poor 15 [Illustrative]. Missing condition stays missing. |')
  lines.push('| Open maintenance | 15 [Illustrative] | Sum room-linked Open / In progress complaints: Critical 7 [Illustrative], High 5 [Illustrative], Medium 3 [Illustrative], Low 1 [Illustrative]; capped at 15 [Illustrative]. |')
  lines.push('| Repeat complaints | 10 [Illustrative] | At least 2 [Illustrative] complaints with the same recorded category linked to the room within the existing 180-day [Illustrative] look-back; all complaint statuses included. Award once, not per category. |')
  lines.push('Sum available components, cap at 100 [Illustrative]; missing components are listed and not rescaled. Without capacity or occupancy evidence the room remains unassessed. Stored areaM2 is square-metre area, not a certified carpet-area measure; the Rooms rule does not consume area or calculate an area-per-person norm.', '')

  lines.push('## Nearby infrastructure near the college gate', '')
  lines.push(`**${NEARBY_RULE_LABEL}.** ${NEARBY_RULE}`)
  lines.push('Half [Illustrative rule threshold] of recorded conditions is the Critical boundary. Nearby records are college-scoped. An authority action only opens a public issue draft; no external message is sent.', '')
  lines.push('| Type | Good | Fair | Poor | Not recorded | Estimated daily users | Status |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const row of analysis.nearby) {
    // Each condition count takes the weakest basis of the records behind it.
    const tagFor = (condition: 'good' | 'fair' | 'poor') =>
      weakestTag(row.records.filter((asset) => asset.condition === condition).map((asset) => titleCase(asset.basis) as FigureTag))
    const unknownTag = weakestTag(
      row.records.filter((asset) => asset.condition === null).map((asset) => titleCase(asset.basis) as FigureTag),
    )
    const users = row.dailyUsers === null ? 'Not entered [Missing]' : `${figure(row.dailyUsers, 'Estimated')}${row.usersMissing ? ' (partial total)' : ''}`
    lines.push(`| ${row.label} | ${figure(row.good, tagFor('good'))} | ${figure(row.fair, tagFor('fair'))} | ${figure(row.poor, tagFor('poor'))} | ${figure(row.unknown, unknownTag)} | ${users} | ${row.statusLabel} |`)
  }
  lines.push('', '### Nearby asset evidence', '')
  lines.push('| Asset ID | Type | Location | Gate distance | Condition | Daily users | How obtained | Authority | Basis |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const row of analysis.nearby) {
    for (const asset of row.records) {
      const tag = titleCase(asset.basis) as FigureTag
      lines.push(`| ${mdEscape(asset.id)} | ${row.label} | ${mdEscape(asset.locationDescription)} | ${figure(asset.distanceMetres, titleCase(asset.distanceBasis) as FigureTag, 'm')} | ${asset.condition ? titleCase(asset.condition) : 'Not recorded [Missing]'} | ${asset.dailyUsers === null ? 'Not entered [Missing]' : figure(asset.dailyUsers, tag)} | ${mdEscape(asset.usersMethod ?? 'Not entered')} | ${mdEscape(asset.responsibleAuthority ?? 'Not recorded')} | ${figureTag(tag)} |`)
    }
  }
  lines.push('')
  lines.push('## 3. Electricity and water', '')
  lines.push('| Meter | Building | Utility | Reading type | Known consumption | Consumption tag | Missing readings | Cost estimate | Quality | Basis |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const meter of u.meters) {
    const consumption = figure(meter.knownPeriods === 0 ? null : meter.knownConsumption, meterFigureTag(meter), meter.meter.unit)
    lines.push(`| ${mdEscape(meter.meter.label)} | ${mdEscape(meter.buildingName)} | ${titleCase(meter.meter.utility)} | ${titleCase(meter.meter.readingType)} | ${consumption}${meter.missingReadings > 0 ? ' (lower bound)' : ''} | ${meterFigureTag(meter)} | ${figure(meter.missingReadings)} | ${money(meter.estimatedCost, meter.costCurrency, 'Estimated')}${meter.estimatedCost !== null && !meter.costComplete ? ' (partial)' : ''} | ${titleCase(meter.quality)} | ${figureTag(recordTag(meter.meter.basis))} |`)
  }
  lines.push('', '### Thresholds by category', '')
  const waterLimit = workspace.needsLimits.find((limit) => limit.category === 'water')
  lines.push('- Rooms: recorded seats per room and enrolled people per scheduled class feed the fixed Needs Score bands described above; no administrator limit field.')
  if (waterLimit) {
    lines.push(`- Water limit: ${figure(waterLimit.limit, waterLimit.kind === 'project_assumption' ? 'Illustrative' : 'Measured', waterLimit.unit)} per water meter per month — ${THRESHOLD_KIND_LABELS[waterLimit.kind]}, source “${mdEscape(waterLimit.source)}”, recorded by ${mdEscape(waterLimit.updatedByName)} on ${formatDateTime(waterLimit.updatedAt)}. Each meter's latest known comparable month is checked; above the limit is Critical, at or below is Adequate.`)
  } else {
    lines.push('- Water limit: no limit recorded [Missing], so the Water needs row reports Not enough data. No default value is supplied. The limit would mean consumption per water meter per month, in that meter’s unit.')
  }
  lines.push('- Lighting: asset records are not a fault count; no rule takes a limit or unit.')
  lines.push('- Waste: no recorded demand/capacity comparison; no rule takes a limit or unit.')
  lines.push('- Parking: no recorded demand/capacity comparison; no rule takes a limit or unit.')
  lines.push('Lighting, Waste and Parking have no rule in this build that takes a limit; they remain Not enough data.', '')

  const flagged = u.meters.flatMap((meter) => meter.spikes.map((spike) => ({ meter, spike })))
  if (flagged.length > 0) {
    lines.push('### Flagged spikes (statistical prompt, cause unknown)', '')
    for (const { meter, spike } of flagged) {
      lines.push(`- ${mdEscape(meter.meter.label)}: ${figure(spike.consumption, 'Measured', meter.meter.unit)} at ${formatDate(spike.at)} — baseline ${figure(spike.baseline, 'Estimated')}, ${figure(spike.deviationPct * 100, 'Estimated', '%')} above median.`)
    }
    lines.push('')
  }
  const gaps = u.meters.flatMap((meter) => meter.gaps.map((gap) => ({ meter, gap })))
  if (gaps.length > 0) {
    lines.push('### Missing periods and unexpected spacing', '')
    for (const { meter, gap } of gaps) lines.push(`- ${mdEscape(meter.meter.label)}: ${mdEscape(gap.detail)} [Missing] (${formatDate(gap.at)}).`)
    lines.push('')
  }
  const resets = u.meters.flatMap((meter) => meter.resets.map((reset) => ({ meter, reset })))
  if (resets.length > 0) {
    lines.push('### Meter resets', '')
    for (const { meter, reset } of resets) {
      lines.push(`- ${mdEscape(meter.meter.label)}: register fell from ${figure(reset.previousValue, meterFigureTag(meter))} to ${figure(reset.value, meterFigureTag(meter))} at ${formatDate(reset.at)}. No negative consumption was produced.`)
    }
    lines.push('')
  }
  lines.push('**Utility method:** missing readings stay missing; cumulative registers are differenced and resets are not consumption; multi-period differences are labelled and excluded from spike checks. Estimated meters cannot raise spike prompts. Costs use the applicable recorded tariff. Totals are lower bounds where readings are missing.', '')

  lines.push('## 4. Maintenance and issues', '')
  if (m.ranked.length === 0) lines.push('No active complaints are visible to this account.')
  else {
    lines.push('| Priority | Score | Category | Severity | Target | Age (days) | Status | Description | Basis |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const ranked of m.ranked) {
      lines.push(`| ${ranked.bandLabel} | ${figure(ranked.score, 'Estimated')} | ${mdEscape(ranked.category)} | ${titleCase(ranked.severity)} | ${mdEscape(ranked.targetLabel)} | ${figure(ranked.ageDays, 'Estimated')} | ${titleCase(ranked.status)} | ${mdEscape(ranked.description.slice(0, 140))} | ${figureTag(rowTag([ranked.complaintId]))} |`)
    }
  }
  if (m.repeats.length > 0 || m.publicRepeats.length > 0) {
    lines.push('', '### Repeat patterns', '')
    for (const repeat of [...m.repeats, ...m.publicRepeats]) {
      lines.push(`- ${mdEscape(repeat.targetLabel)} — ${mdEscape(repeat.category)}: ${figure(repeat.count)} reports, ${figure(repeat.openCount)} still open, last on ${formatDate(repeat.lastAt)}.`)
    }
  }
  if (m.inspectionAlerts.length > 0) {
    lines.push('', '### Inspection alerts', '')
    for (const alert of m.inspectionAlerts) lines.push(`- ${mdEscape(alert.assetName)}: ${mdEscape(alert.detail)} [Estimated]`)
  }
  if (data.urbanIssues.length > 0) {
    lines.push('', '### Public infrastructure reports reported by this college', '')
    for (const issue of data.urbanIssues) {
      lines.push(`- ${mdEscape(issue.category)} at ${mdEscape(issue.locationLabel)} — ${titleCase(issue.severity)}, ${titleCase(issue.status)}, reported ${formatDateTime(issue.reportedAt)}${issue.authority ? `, responsible authority: ${mdEscape(issue.authority)}` : ''}.`)
    }
  }
  const weights = workspace.priorityWeights
  const weightSource = weights.updatedAt
    ? `set by ${mdEscape(weights.updatedByName ?? 'an administrator')} on ${formatDateTime(weights.updatedAt)}`
    : 'built-in defaults; no administrator change recorded'
  lines.push('', `**Priority weights [Illustrative]:** severity ${figure(weights.severity, 'Illustrative')}, poor condition ${figure(weights.condition, 'Illustrative')}, people affected ${figure(weights.usersAffected, 'Illustrative')} per ${figure(10, 'Illustrative', 'people')}, age ${figure(weights.daysOpen, 'Illustrative')} per ${figure(3, 'Illustrative', 'days')}. Source: MicroCity maintenance priority rule — Project assumption; ${weightSource}. Existing status, repeat and asset-risk components still apply. This is a guide to what to look at first, not a safety assessment.`, '')

  lines.push('## 5. Plan options and decisions', '')
  if (p.options.length === 0) lines.push('No plan options are recorded.')
  for (const option of p.options) {
    lines.push(`### ${mdEscape(option.title)}`, '')
    lines.push(`- Type: ${titleCase(option.optionType)}`)
    lines.push(`- Basis: ${figureTag(rowTag([option.optionId]))}`)
    lines.push(`- Addresses finding: ${mdEscape(option.addressesFinding)}${option.finding ? ` (${option.finding.severity})` : ' (no matching finding in the current analysis)'}`)
    lines.push(`- Capital cost: ${money(option.capitalCost)}; annual cost: ${money(option.annualCost)}; annual savings: ${money(option.annualSavings)}`)
    lines.push(`- Net annual benefit: ${money(option.netAnnualBenefit)}; simple payback: ${figure(option.simplePaybackMonths, 'Illustrative', 'months')}`)
    lines.push(`- Seat effect: ${figure(option.seatEffect, 'Illustrative', 'seats')}${option.seatEffect !== null && !option.seatEffectComplete ? ' (partial)' : ''}`)
    lines.push(`- Disruption: ${figure(option.disruptionDays, 'Illustrative', 'days')}; implementation: ${figure(option.implementationWeeks, 'Illustrative', 'weeks')}`)
    lines.push(`- Assumptions: ${mdEscape(option.assumptions || 'None recorded')} [Illustrative]`)
    lines.push(`- Risks: ${mdEscape(option.risks || 'None recorded')} [Illustrative]`)
    lines.push(`- Evidence: ${mdEscape(option.evidence || 'None recorded')} [Illustrative]`)
    lines.push(`- Decision: ${option.decision ? `${titleCase(option.decision.status)} — ${option.decision.decidedAt ? formatDateTime(option.decision.decidedAt) : 'no decision time recorded'}; owner ${mdEscape(option.decision.ownerName ?? 'Not assigned')}` : 'No decision recorded'}`, '')
  }
  if (p.unaddressedFindings.length > 0) {
    lines.push('### High-priority findings not linked to an option', '')
    for (const finding of p.unaddressedFindings) lines.push(`- **${titleCase(finding.severity)}** — ${mdEscape(finding.title)} [Estimated]`)
  }
  lines.push('', '**Plan method:** costs, savings and effects come from recorded options. Missing inputs never become zero. No automatic recommendation is made. Only an administrator can approve, reject or defer decisions.', '')

  lines.push('## 6. Data quality and limitations', '')
  lines.push(`- Dataset: ${mdEscape(provenance.name)}; generated ${formatDate(provenance.generatedAt)} by ${mdEscape(provenance.generator)}.`)
  lines.push(`- Records in scope: ${figure(data.buildings.length)} buildings, ${figure(data.rooms.length)} rooms, ${figure(data.timetableSlots.length)} timetable slots, ${figure(data.assets.length)} assets, ${figure(data.utilityReadings.length)} utility readings.`)
  lines.push(`- Missing demand records: ${figure(c.rooms.reduce((total, room) => total + room.missingDemandSlots, 0))} timetable slot(s); missing attendance records: ${figure(c.rooms.reduce((total, room) => total + room.missingAttendanceSlots, 0))} slot(s).`)
  lines.push(`- Figures were calculated at ${formatDateTime(analysis.asOf)}; later changes are not reflected in this export.`)
  lines.push('- This report does not create, approve or authorise spending, closures or safety decisions. Human confirmation is required.', '')
  return lines.join('\n')
}

export function buildReportCsv(input: ReportInputWithSummary): string {
  const rows: string[][] = [['section', 'record', 'field', 'value', 'figure_tags']]
  let section = 'Report'
  let subsection = ''
  let tableHeaders: string[] = []
  const plain = (text: string) => text.replace(/\*\*/g, '').replace(/\\\|/g, '|')
  const addRow = (record: string, field: string, value: string) => {
    const tags = [...new Set([...value.matchAll(/\[(Measured|Estimated|Illustrative|Missing)\]/g)].map((match) => match[1]))]
    rows.push([section, plain(record), plain(field), plain(value), tags.join(', ')])
  }
  for (const line of buildReportMarkdown(input).split('\n')) {
    if (!line.trim()) {
      tableHeaders = []
      continue
    }
    if (line.startsWith('### ')) subsection = line.slice(4)
    else if (line.startsWith('## ')) {
      section = line.slice(3)
      subsection = ''
    } else if (line.startsWith('# ')) addRow('', 'Title', line.slice(2))
    else if (line.startsWith('| ')) {
      const cells = line.slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim())
      if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue
      if (tableHeaders.length === 0) tableHeaders = cells
      else for (let index = 1; index < cells.length; index += 1) {
        addRow(subsection ? `${subsection} — ${cells[0]}` : cells[0], tableHeaders[index], cells[index])
      }
    } else addRow(subsection, 'Note', line.replace(/^(?:- |> )/, ''))
  }
  return rows
    .map((row) => row.map((cell) => {
      const value = String(cell)
      const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value
      return `"${safe.replace(/"/g, '""')}"`
    }).join(','))
    .join('\r\n')
}

export function reportFileName(collegeName: string, asOf: string): string {
  const slug = collegeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `microcity-report-${slug}-${asOf.slice(0, 10)}.md`
}
