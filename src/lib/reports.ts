/**
 * Deterministic report builder. Every sentence is derived from recorded data
 * or a documented calculation. AI summaries are appended separately and are
 * always labelled "AI-generated — please verify".
 */
import type { AnalysisBundle } from '../domain/analysis'
import type { WorkspacePayload } from '../domain/types'
import { formatCurrency, formatDate, formatDateTime, formatNumber, percentage, titleCase } from './format'

export interface ReportInput {
  workspace: WorkspacePayload
  analysis: AnalysisBundle
  preparedBy: string
  roleLabel: string
}

function mdEscape(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function money(value: number | null, currency: string | null = 'INR'): string {
  return value === null ? 'Not recorded' : formatCurrency(value, currency ?? 'INR')
}

export function buildReportMarkdown({ workspace, analysis, preparedBy, roleLabel }: ReportInput): string {
  const college = workspace.activeCollege.name
  const provenance = workspace.provenance
  const c = analysis.capacity
  const u = analysis.utilities
  const m = analysis.maintenance
  const p = analysis.plan
  const lines: string[] = []

  lines.push(`# MicroCity infrastructure report — ${college}`)
  lines.push('')
  lines.push(`**Generated:** ${formatDateTime(analysis.asOf)}  `)
  lines.push(`**Prepared by:** ${preparedBy} (${roleLabel})  `)
  lines.push(`**College scope:** ${college}  `)
  lines.push(`**Data source:** ${provenance.name} — ${provenance.synthetic ? 'SYNTHETIC base data' : 'recorded data'}, ${provenance.license}`)
  lines.push('')
  lines.push(
    '> This report contains figures calculated by MicroCity from the records visible to the signed-in account. ' +
      'It is not an engineering survey, a statutory inspection or a financial forecast. Missing values remain missing and are not treated as zero.',
  )
  if (provenance.notes) lines.push(`> ${provenance.notes}`)
  lines.push('')

  lines.push('## 1. Summary')
  lines.push('')
  lines.push(`- Findings by severity: ${analysis.findingCounts.critical} critical, ${analysis.findingCounts.high} high, ${analysis.findingCounts.medium} medium, ${analysis.findingCounts.low} low, ${analysis.findingCounts.info} informational.`)
  lines.push(`- Rooms assessed: ${c.assessedRooms}; unassessed: ${c.unassessedRooms}; ${c.shortages.length} capacity shortfall slot(s); ${c.overlaps.length} timetable overlap(s).`)
  lines.push(`- Electricity recorded consumption: ${formatNumber(u.totals.electricity.consumption)} ${u.totals.electricity.unit}${u.totals.electricity.cost !== null ? ` (estimated ${formatCurrency(u.totals.electricity.cost, u.totals.electricity.currency)})` : ' (cost not calculated)'}.`)
  lines.push(`- Water recorded consumption: ${formatNumber(u.totals.water.consumption)} ${u.totals.water.unit}${u.totals.water.cost !== null ? ` (estimated ${formatCurrency(u.totals.water.cost, u.totals.water.currency)})` : ' (cost not calculated)'}.`)
  lines.push(`- Utility quality: ${u.missingCount} missing reading(s), ${u.spikeCount} flagged spike(s), ${u.resetCount} meter reset(s).`)
  lines.push(`- Active complaints ranked: ${m.activeCount}; closed or resolved in view: ${m.closedCount}; repeat groups: ${m.repeats.length + m.publicRepeats.length}.`)
  lines.push(`- Inspections: ${m.overdueInspectionCount} overdue, ${m.dueSoonInspectionCount} due soon.`)
  lines.push(`- Plan options: ${p.options.length}; ${p.approvalCounts.approved} approved, ${p.approvalCounts.proposed} proposed, ${p.approvalCounts.none} with no decision.`)
  lines.push('')

  lines.push('## 2. Room capacity and needs')
  lines.push('')
  if (c.rooms.length === 0) {
    lines.push('_No rooms are recorded for this college._')
  } else {
    lines.push('| Room | Building | Capacity | Peak expected | Shortage slots | Utilisation | Needs score | Status |')
    lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |')
    for (const room of c.rooms) {
      lines.push(
        `| ${mdEscape(room.code)}${room.name ? ` — ${mdEscape(room.name)}` : ''} | ${mdEscape(room.buildingName)} | ${
          room.capacity ?? 'Not recorded'
        } | ${room.expectedPeak ?? 'Not recorded'} | ${room.shortageSlots} | ${percentage(room.averageUtilisation)} | ${
          room.score ?? 'Not scored'
        } | ${titleCase(room.status)} |`,
      )
    }
    lines.push('')
    if (c.shortages.length > 0) {
      lines.push('### Recorded capacity shortfalls')
      lines.push('')
      lines.push('| Room | Activity | Starts | Expected | Capacity | Shortfall |')
      lines.push('| --- | --- | --- | ---: | ---: | ---: |')
      for (const shortage of c.shortages) {
        lines.push(
          `| ${mdEscape(shortage.roomCode)} | ${mdEscape(shortage.activity)} | ${formatDateTime(shortage.startsAt)} | ${shortage.expectedAttendance} | ${shortage.capacity} | ${shortage.shortageSeats} |`,
        )
      }
      lines.push('')
    }
    if (c.overlaps.length > 0) {
      lines.push('### Timetable overlaps')
      lines.push('')
      for (const overlap of c.overlaps) {
        lines.push(
          `- ${overlap.roomCode}: ${overlap.minutes} minutes overlap between “${overlap.a.activity}” and “${overlap.b.activity}”.`,
        )
      }
      lines.push('')
    }
    lines.push('**Needs score method:** capacity shortfall up to 40 points, observed occupancy pressure up to 20 (only with attendance and capacity), recorded condition up to 15, unresolved maintenance up to 15, repeat category history up to 10. Bands: 60+ critical, 30–59 stressed. A score is not produced when capacity or occupancy records are missing.')
    lines.push('')
  }

  lines.push('## 3. Electricity and water')
  lines.push('')
  lines.push('| Meter | Building | Utility | Reading type | Known consumption | Missing | Cost estimate | Quality |')
  lines.push('| --- | --- | --- | --- | ---: | ---: | ---: | --- |')
  for (const meter of u.meters) {
    lines.push(
      `| ${mdEscape(meter.meter.label)} | ${mdEscape(meter.buildingName)} | ${titleCase(meter.meter.utility)} | ${titleCase(meter.meter.readingType)} | ${formatNumber(meter.knownConsumption)} ${meter.meter.unit} | ${meter.missingReadings} | ${money(meter.estimatedCost, meter.costCurrency)}${meter.costComplete ? '' : ' (partial)'} | ${titleCase(meter.quality)} |`,
    )
  }
  lines.push('')
  const flagged = u.meters.flatMap((meter) =>
    meter.spikes.map((spike) => ({ meter, spike })),
  )
  if (flagged.length > 0) {
    lines.push('### Flagged spikes (statistical prompt, cause unknown)')
    lines.push('')
    for (const { meter, spike } of flagged) {
      lines.push(
        `- ${meter.meter.label}: ${formatNumber(spike.consumption)} ${meter.meter.unit} at ${formatDate(spike.at)} — baseline ${formatNumber(spike.baseline)}, ${spike.deviationPct.toFixed(0)}% above median.`,
      )
    }
    lines.push('')
  }
  const gaps = u.meters.flatMap((meter) => meter.gaps.map((gap) => ({ meter, gap })))
  if (gaps.length > 0) {
    lines.push('### Missing periods and unexpected spacing')
    lines.push('')
    for (const { meter, gap } of gaps) {
      lines.push(`- ${meter.meter.label}: ${gap.detail} (${formatDate(gap.at)}).`)
    }
    lines.push('')
  }
  const resets = u.meters.flatMap((meter) => meter.resets.map((reset) => ({ meter, reset })))
  if (resets.length > 0) {
    lines.push('### Meter resets')
    lines.push('')
    for (const { meter, reset } of resets) {
      lines.push(
        `- ${meter.meter.label}: register fell from ${formatNumber(reset.previousValue)} to ${formatNumber(reset.value)} at ${formatDate(reset.at)}. No negative consumption was produced.`,
      )
    }
    lines.push('')
  }
  lines.push('**Utility method:** missing readings stay missing; cumulative registers are differenced and resets are not consumption; multi-period differences are labelled; costs use the latest applicable recorded tariff and exclude standing charges from per-reading allocation. Totals are lower bounds where readings are missing.')
  lines.push('')

  lines.push('## 4. Maintenance and issues')
  lines.push('')
  if (m.ranked.length === 0) {
    lines.push('_No active complaints are visible to this account._')
  } else {
    lines.push('| Priority | Score | Category | Severity | Target | Age (days) | Status | Description |')
    lines.push('| --- | ---: | --- | --- | --- | ---: | --- | --- |')
    for (const ranked of m.ranked) {
      lines.push(
        `| ${ranked.bandLabel} | ${ranked.score} | ${mdEscape(ranked.category)} | ${titleCase(ranked.severity)} | ${mdEscape(ranked.targetLabel)} | ${ranked.ageDays} | ${titleCase(ranked.status)} | ${mdEscape(ranked.description.slice(0, 140))} |`,
      )
    }
    lines.push('')
  }
  if (m.repeats.length > 0 || m.publicRepeats.length > 0) {
    lines.push('### Repeat patterns (180-day window)')
    lines.push('')
    for (const repeat of [...m.repeats, ...m.publicRepeats]) {
      lines.push(
        `- ${repeat.targetLabel} — ${repeat.category}: ${repeat.count} reports, ${repeat.openCount} still open, last on ${formatDate(repeat.lastAt)}.`,
      )
    }
    lines.push('')
  }
  if (m.inspectionAlerts.length > 0) {
    lines.push('### Inspection alerts')
    lines.push('')
    for (const alert of m.inspectionAlerts) {
      lines.push(`- ${alert.assetName}: ${alert.detail}`)
    }
    lines.push('')
  }
  if (workspace.dataset.urbanIssues.length > 0) {
    lines.push('### Public infrastructure reports (shared, not college-owned)')
    lines.push('')
    for (const issue of workspace.dataset.urbanIssues) {
      lines.push(
        `- ${issue.category} at ${issue.locationLabel} — ${titleCase(issue.severity)}, ${titleCase(issue.status)}, reported ${formatDate(issue.reportedAt)}${issue.authority ? `, responsible authority: ${issue.authority}` : ''}.`,
      )
    }
    lines.push('')
  }
  lines.push('**Priority method:** severity 40/25/12/4, open +10 or in-progress +4, people affected up to 15 (unavailable if not recorded), age up to 15, repeats up to 15, linked asset risk up to 12. P1 at 70+, P2 at 45+, P3 at 25+. This is a guide to what to look at first, not a safety assessment.')
  lines.push('')

  lines.push('## 5. Plan options and decisions')
  lines.push('')
  if (p.options.length === 0) {
    lines.push('_No plan options are recorded._')
  } else {
    for (const option of p.options) {
      lines.push(`### ${option.title}`)
      lines.push('')
      lines.push(`- Type: ${titleCase(option.optionType)}`)
      lines.push(`- Addresses finding: ${option.addressesFinding}${option.finding ? ` (${option.finding.severity})` : ' (no matching finding in the current analysis)'}`)
      lines.push(`- Capital cost: ${money(option.capitalCost)}; annual cost: ${money(option.annualCost)}; annual savings: ${money(option.annualSavings)}`)
      lines.push(`- Net annual benefit: ${money(option.netAnnualBenefit)}; simple payback: ${option.simplePaybackMonths === null ? 'Not calculated' : `${option.simplePaybackMonths.toFixed(1)} months`}`)
      lines.push(`- Seat effect: ${option.seatEffect === null ? 'Not recorded' : `${option.seatEffect} seats${option.seatEffectComplete ? '' : ' (partial)'}`}`)
      lines.push(`- Disruption: ${option.disruptionDays ?? 'Not recorded'} days; implementation: ${option.implementationWeeks ?? 'Not recorded'} weeks`)
      lines.push(`- Assumptions: ${option.assumptions || 'None recorded'}`)
      lines.push(`- Risks: ${option.risks || 'None recorded'}`)
      lines.push(`- Evidence: ${option.evidence || 'None recorded'}`)
      lines.push(`- Decision: ${option.decision ? `${titleCase(option.decision.status)} — ${option.decision.decidedAt ? formatDateTime(option.decision.decidedAt) : 'no decision time recorded'}${option.decision.ownerName ? `; owner ${option.decision.ownerName}` : ''}` : 'No decision recorded'}`)
      lines.push('')
    }
  }
  if (p.unaddressedFindings.length > 0) {
    lines.push('### High-priority findings not linked to an option')
    lines.push('')
    for (const finding of p.unaddressedFindings) {
      lines.push(`- **${titleCase(finding.severity)}** — ${finding.title}`)
    }
    lines.push('')
  }
  lines.push('**Plan method:** costs, savings and effects are copied from recorded options. No automatic recommendation is made. Only an administrator can record an approved, rejected or deferred decision.')
  lines.push('')

  lines.push('## 6. Data quality and limitations')
  lines.push('')
  lines.push(`- Dataset: ${provenance.name}; generated ${formatDate(provenance.generatedAt)} by ${provenance.generator}.`)
  lines.push(`- Records in scope: ${workspace.dataset.buildings.length} buildings, ${workspace.dataset.rooms.length} rooms, ${workspace.dataset.timetableSlots.length} timetable slots, ${workspace.dataset.assets.length} assets, ${workspace.dataset.utilityReadings.length} utility readings.`)
  lines.push(`- Missing demand records: ${c.rooms.reduce((total, room) => total + room.missingDemandSlots, 0)} timetable slot(s); missing attendance records: ${c.rooms.reduce((total, room) => total + room.missingAttendanceSlots, 0)} slot(s).`)
  lines.push(`- The figures were calculated at ${formatDateTime(analysis.asOf)}; records changed afterwards are not reflected in this export.`)
  lines.push('- This report does not create, approve or authorise spending, closures or safety decisions. Human confirmation is required.')
  lines.push('')

  return lines.join('\n')
}

export function buildFindingsCsv(analysis: AnalysisBundle): string {
  const header = ['severity', 'module', 'title', 'summary', 'evidence', 'limitations']
  const rows = analysis.findings.map((finding) => [
    finding.severity,
    finding.module,
    finding.title,
    finding.summary,
    finding.evidence.join(' | '),
    finding.limitations.join(' | '),
  ])
  return [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
}

export function reportFileName(collegeName: string, asOf: string): string {
  const slug = collegeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `microcity-report-${slug}-${asOf.slice(0, 10)}.md`
}
