/**
 * Maintenance triage, repeat-issue detection and inspection monitoring.
 *
 * Priority is a transparent triage score, not an SLA or an engineering risk
 * assessment. Every point is attributable to a recorded field. Missing
 * people-affected counts are not scored as zero risk; they are marked
 * unavailable. Repeat issues use a fixed 180-day window and exact target +
 * category matching.
 */
import type {
  Asset,
  Building,
  Complaint,
  ComplaintStatus,
  Inspection,
  PriorityWeights,
  Room,
  Severity,
  UrbanAsset,
  UrbanIssue,
} from '../types.ts'
import { DEFAULT_PRIORITY_WEIGHTS } from '../types.ts'
import type { Finding, FindingSeverity } from './types.ts'
import { formatIstDate } from '../../lib/time.ts'

export const PRIORITY_BANDS = { urgent: 70, high: 45, medium: 25 } as const
export const REPEAT_WINDOW_DAYS = 180
export const INSPECTION_DUE_SOON_DAYS = 7

export type PriorityBand = 'P1' | 'P2' | 'P3' | 'P4'
export type PriorityBandLabel = 'P1 · Urgent' | 'P2 · High' | 'P3 · Medium' | 'P4 · Routine'

export interface PriorityComponent {
  key: 'severity' | 'status' | 'people' | 'age' | 'repeat' | 'asset'
  label: string
  points: number
  available: boolean
  detail: string
}

export interface ComplaintPriority {
  complaintId: string
  description: string
  category: string
  severity: Severity
  status: ComplaintStatus
  targetType: 'room' | 'asset' | 'none'
  targetId: string | null
  targetLabel: string
  raisedAt: string
  ageDays: number
  assignedToUserId: string | null
  score: number
  band: PriorityBand
  bandLabel: PriorityBandLabel
  components: PriorityComponent[]
  repeatCount: number
  peopleAffected: number | null
}

export interface RepeatIssue {
  id: string
  targetType: 'room' | 'asset' | 'public' | 'none'
  targetId: string | null
  targetLabel: string
  category: string
  count: number
  openCount: number
  firstAt: string
  lastAt: string
  windowDays: number
  recordIds: string[]
}

export type InspectionAlertKind =
  | 'overdue'
  | 'due-soon'
  | 'missing-completion'
  | 'interval-overdue'
  | 'interval-due-soon'
  | 'no-baseline'
  | 'no-regime'

export interface InspectionAlert {
  id: string
  kind: InspectionAlertKind
  assetId: string
  assetName: string
  inspectionId: string | null
  dueAt: string | null
  days: number | null
  severity: FindingSeverity
  detail: string
}

export interface MaintenanceAnalysis {
  ranked: ComplaintPriority[]
  activeCount: number
  closedCount: number
  bySeverity: Record<Severity, number>
  byStatus: Record<ComplaintStatus, number>
  repeats: RepeatIssue[]
  publicRepeats: RepeatIssue[]
  inspectionAlerts: InspectionAlert[]
  overdueInspectionCount: number
  dueSoonInspectionCount: number
  openPublicIssues: number
  findings: Finding[]
  methods: string[]
}

const SEVERITY_RATIO: Record<Severity, number> = { critical: 1, high: 0.625, medium: 0.3, low: 0.1 }
const STATUS_POINTS: Record<'open' | 'in_progress', number> = { open: 10, in_progress: 4 }

function methodsFor(weights: PriorityWeights): string[] {
  const severity = (value: Severity) => Math.round(weights.severity * SEVERITY_RATIO[value])
  return [
    `Base severity: critical ${severity('critical')}, high ${severity('high')}, medium ${severity('medium')}, low ${severity('low')} points. Open adds 10; in-progress adds 4. Resolved and closed reports are not ranked.`,
    `People affected adds ${weights.usersAffected} point${weights.usersAffected === 1 ? '' : 's'} per 10 people, capped at 15. When the count is not recorded the component is marked unavailable and not scored.`,
    `Age adds ${weights.daysOpen} point${weights.daysOpen === 1 ? '' : 's'} per 3 days since the report was raised, capped at 15.`,
    `Repeat: each earlier complaint with the same room/asset target and category within ${REPEAT_WINDOW_DAYS} days adds 5 points, capped at 15. Reports without a linked target cannot be repeat-matched.`,
    `Linked-asset risk adds 8 points for criticality "critical" and 4 for "high"; poor asset condition adds ${weights.condition}. Points are shown individually so they can be audited.`,
    `Bands: P1 at ${PRIORITY_BANDS.urgent}+, P2 at ${PRIORITY_BANDS.high}+, P3 at ${PRIORITY_BANDS.medium}+, otherwise P4. Weights apply to both campus and public work; the score helps order the work and is not a safety assessment or a service-level guarantee.`,
    `Inspection alerts use recorded schedules. Overdue means the scheduled date has passed; due soon means within ${INSPECTION_DUE_SOON_DAYS} days. Interval alerts are only produced when an asset has a recorded interval and inspection history and no open scheduled inspection.`,
  ]
}

const DAY_MS = 86_400_000

function dayValue(at: string): number | null {
  const time = Date.parse(at)
  return Number.isNaN(time) ? null : time
}

function daysSince(at: string, asOf: string): number {
  const from = dayValue(at)
  const to = dayValue(asOf)
  if (from === null || to === null) return 0
  return Math.max(0, Math.floor((to - from) / DAY_MS))
}

function daysUntil(at: string, asOf: string): number | null {
  const target = dayValue(at)
  const now = dayValue(asOf)
  if (target === null || now === null) return null
  return Math.ceil((target - now) / DAY_MS)
}

function formatDate(at: string): string {
  return formatIstDate(at) ?? at
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function severityLabel(value: Severity): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function statusLabel(value: ComplaintStatus): string {
  return value.replace('_', ' ')
}

function bandFor(score: number): PriorityBand {
  if (score >= PRIORITY_BANDS.urgent) return 'P1'
  if (score >= PRIORITY_BANDS.high) return 'P2'
  if (score >= PRIORITY_BANDS.medium) return 'P3'
  return 'P4'
}

const BAND_LABELS: Record<PriorityBand, PriorityBandLabel> = {
  P1: 'P1 · Urgent',
  P2: 'P2 · High',
  P3: 'P3 · Medium',
  P4: 'P4 · Routine',
}

function targetForComplaint(
  complaint: Complaint,
  rooms: Map<string, Room>,
  buildings: Map<string, Building>,
  assets: Map<string, Asset>,
): { type: 'room' | 'asset' | 'none'; id: string | null; label: string } {
  if (complaint.roomId) {
    const room = rooms.get(complaint.roomId)
    if (room) {
      const building = buildings.get(room.buildingId)
      return {
        type: 'room',
        id: room.id,
        label: `${room.code}${room.name ? ` · ${room.name}` : ''}${building ? ` (${building.name})` : ''}`,
      }
    }
  }
  if (complaint.assetId) {
    const asset = assets.get(complaint.assetId)
    if (asset) return { type: 'asset', id: asset.id, label: asset.name }
  }
  return { type: 'none', id: null, label: 'No linked room or asset' }
}

function countEarlierRepeats(
  complaint: Complaint,
  complaints: Complaint[],
  keysById: Map<string, string>,
): number {
  const key = keysById.get(complaint.id)
  if (!key) return 0
  const raised = dayValue(complaint.raisedAt)
  if (raised === null) return 0
  const windowStart = raised - REPEAT_WINDOW_DAYS * DAY_MS
  return complaints.filter((other) => {
    if (other.id === complaint.id || keysById.get(other.id) !== key) return false
    const time = dayValue(other.raisedAt)
    return time !== null && time >= windowStart && time < raised
  }).length
}

function repeatKey(complaint: Complaint): string | null {
  if (!complaint.roomId && !complaint.assetId) return null
  const target = complaint.roomId ? `room:${complaint.roomId}` : `asset:${complaint.assetId as string}`
  return `${target}|${complaint.category.trim().toLowerCase()}`
}

function buildRepeatGroups(
  complaints: Complaint[],
  rooms: Map<string, Room>,
  buildings: Map<string, Building>,
  assets: Map<string, Asset>,
): RepeatIssue[] {
  const groups = new Map<string, Complaint[]>()
  for (const complaint of complaints) {
    const key = repeatKey(complaint)
    if (!key) continue
    const list = groups.get(key) ?? []
    list.push(complaint)
    groups.set(key, list)
  }

  const repeats: RepeatIssue[] = []
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const sorted = [...members].sort((a, b) => Date.parse(a.raisedAt) - Date.parse(b.raisedAt))
    const lastAt = sorted[sorted.length - 1].raisedAt
    const lastTime = dayValue(lastAt) ?? 0
    const recent = sorted.filter((member) => {
      const time = dayValue(member.raisedAt)
      return time !== null && lastTime - time <= REPEAT_WINDOW_DAYS * DAY_MS
    })
    if (recent.length < 2) continue
    const first = recent[0]
    const target = targetForComplaint(first, rooms, buildings, assets)
    repeats.push({
      id: `repeat-${target.type}-${target.id ?? 'none'}-${slug(first.category)}`,
      targetType: target.type,
      targetId: target.id,
      targetLabel: target.label,
      category: first.category,
      count: recent.length,
      openCount: recent.filter((member) => member.status === 'open' || member.status === 'in_progress').length,
      firstAt: first.raisedAt,
      lastAt,
      windowDays: REPEAT_WINDOW_DAYS,
      recordIds: recent.map((member) => member.id),
    })
  }
  return repeats.sort((a, b) => {
    if (b.openCount !== a.openCount) return b.openCount - a.openCount
    if (b.count !== a.count) return b.count - a.count
    return Date.parse(b.lastAt) - Date.parse(a.lastAt)
  })
}

function buildPublicRepeats(issues: UrbanIssue[], assets: Map<string, UrbanAsset>): RepeatIssue[] {
  const groups = new Map<string, UrbanIssue[]>()
  for (const issue of issues) {
    const target = issue.urbanAssetId ? `asset:${issue.urbanAssetId}` : `location:${issue.locationLabel.trim().toLowerCase()}`
    const key = `${target}|${issue.category.trim().toLowerCase()}`
    const list = groups.get(key) ?? []
    list.push(issue)
    groups.set(key, list)
  }
  const repeats: RepeatIssue[] = []
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const sorted = [...members].sort((a, b) => Date.parse(a.reportedAt) - Date.parse(b.reportedAt))
    const lastAt = sorted[sorted.length - 1].reportedAt
    const lastTime = dayValue(lastAt) ?? 0
    const recent = sorted.filter((member) => {
      const time = dayValue(member.reportedAt)
      return time !== null && lastTime - time <= REPEAT_WINDOW_DAYS * DAY_MS
    })
    if (recent.length < 2) continue
    const first = recent[0]
    const assetId = first.urbanAssetId
    const asset = assetId ? assets.get(assetId) : undefined
    repeats.push({
      id: `public-repeat-${assetId ?? slug(first.locationLabel)}-${slug(first.category)}`,
      targetType: 'public',
      targetId: assetId,
      targetLabel: asset?.name ?? first.locationLabel,
      category: first.category,
      count: recent.length,
      openCount: recent.filter((issue) => issue.status === 'reported' || issue.status === 'in_progress').length,
      firstAt: first.reportedAt,
      lastAt,
      windowDays: REPEAT_WINDOW_DAYS,
      recordIds: recent.map((issue) => issue.id),
    })
  }
  return repeats.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt))
}

function inspectionAlerts(
  assets: Asset[],
  inspections: Inspection[],
  asOf: string,
): InspectionAlert[] {
  const alerts: InspectionAlert[] = []
  const byAsset = new Map<string, Inspection[]>()
  for (const inspection of inspections) {
    const list = byAsset.get(inspection.assetId) ?? []
    list.push(inspection)
    byAsset.set(inspection.assetId, list)
  }
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))

  for (const inspection of inspections) {
    const asset = assetById.get(inspection.assetId)
    if (!asset) continue
    if (inspection.status === 'scheduled') {
      const days = daysUntil(inspection.scheduledFor, asOf)
      if (days === null) continue
      if (days < 0) {
        alerts.push({
          id: `inspection-${inspection.id}`,
          kind: 'overdue',
          assetId: asset.id,
          assetName: asset.name,
          inspectionId: inspection.id,
          dueAt: inspection.scheduledFor,
          days: Math.abs(days),
          severity: Math.abs(days) >= 14 ? 'high' : 'medium',
          detail:
            `Inspection was due on ${formatDate(inspection.scheduledFor)} and is ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue.` +
            (inspection.inspectorUserId ? '' : ' No inspector is assigned.'),
        })
      } else if (days <= INSPECTION_DUE_SOON_DAYS) {
        alerts.push({
          id: `inspection-${inspection.id}`,
          kind: 'due-soon',
          assetId: asset.id,
          assetName: asset.name,
          inspectionId: inspection.id,
          dueAt: inspection.scheduledFor,
          days,
          severity: 'info',
          detail:
            `Inspection is scheduled for ${formatDate(inspection.scheduledFor)} (${days} day${days === 1 ? '' : 's'} away).` +
            (inspection.inspectorUserId ? '' : ' No inspector is assigned.'),
        })
      }
    }
    if (inspection.status === 'completed' && !inspection.completedAt) {
      alerts.push({
        id: `inspection-${inspection.id}-completion`,
        kind: 'missing-completion',
        assetId: asset.id,
        assetName: asset.name,
        inspectionId: inspection.id,
        dueAt: inspection.scheduledFor,
        days: null,
        severity: 'low',
        detail: 'The inspection is marked completed but no completion time is recorded.',
      })
    }
  }

  for (const asset of assets) {
    const assetInspections = byAsset.get(asset.id) ?? []
    const hasOpenScheduled = assetInspections.some((inspection) => inspection.status === 'scheduled')
    if (asset.inspectionIntervalDays !== null && asset.inspectionIntervalDays > 0) {
      if (!asset.lastInspectedAt) {
        if (asset.criticality === 'critical' || asset.criticality === 'high') {
          alerts.push({
            id: `inspection-baseline-${asset.id}`,
            kind: 'no-baseline',
            assetId: asset.id,
            assetName: asset.name,
            inspectionId: null,
            dueAt: null,
            days: null,
            severity: 'low',
            detail: `A ${asset.inspectionIntervalDays}-day inspection interval is recorded but no previous inspection date is present. Next due date cannot be calculated.`,
          })
        }
        continue
      }
      if (hasOpenScheduled) continue
      const last = dayValue(asset.lastInspectedAt)
      const due = last === null ? null : last + asset.inspectionIntervalDays * DAY_MS
      if (due === null) continue
      const days = Math.ceil((due - (dayValue(asOf) ?? due)) / DAY_MS)
      if (days < 0) {
        alerts.push({
          id: `inspection-interval-${asset.id}`,
          kind: 'interval-overdue',
          assetId: asset.id,
          assetName: asset.name,
          inspectionId: null,
          dueAt: new Date(due).toISOString(),
          days: Math.abs(days),
          severity: asset.criticality === 'critical' ? 'high' : 'medium',
          detail:
            `Last inspected ${formatDate(asset.lastInspectedAt)} with a ${asset.inspectionIntervalDays}-day interval. ` +
            `The interval is ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue and no inspection is scheduled.`,
        })
      } else if (days <= 30) {
        alerts.push({
          id: `inspection-interval-${asset.id}`,
          kind: 'interval-due-soon',
          assetId: asset.id,
          assetName: asset.name,
          inspectionId: null,
          dueAt: new Date(due).toISOString(),
          days,
          severity: 'info',
          detail: `Inspection interval falls due on ${formatDate(new Date(due).toISOString())} (${days} day${days === 1 ? '' : 's'} away).`,
        })
      }
    } else if ((asset.criticality === 'critical' || asset.criticality === 'high') && assetInspections.length === 0) {
      alerts.push({
        id: `inspection-regime-${asset.id}`,
        kind: 'no-regime',
        assetId: asset.id,
        assetName: asset.name,
        inspectionId: null,
        dueAt: null,
        days: null,
        severity: 'low',
        detail: 'No inspection interval or inspection record exists for a high-criticality asset.',
      })
    }
  }

  const kindOrder: Record<InspectionAlertKind, number> = {
    overdue: 0,
    'interval-overdue': 1,
    'missing-completion': 2,
    'no-baseline': 3,
    'no-regime': 4,
    'due-soon': 5,
    'interval-due-soon': 6,
  }
  return alerts.sort((a, b) => {
    const order = kindOrder[a.kind] - kindOrder[b.kind]
    if (order !== 0) return order
    return (b.days ?? 0) - (a.days ?? 0)
  })
}

function inspectionFinding(alert: InspectionAlert): Finding | null {
  if (alert.kind === 'due-soon' || alert.kind === 'interval-due-soon') return null
  const severity: FindingSeverity =
    alert.kind === 'overdue' || alert.kind === 'interval-overdue'
      ? alert.severity
      : alert.kind === 'missing-completion'
        ? 'low'
        : 'low'
  return {
    id: alert.id,
    module: 'maintenance',
    severity,
    title:
      alert.kind === 'overdue'
        ? `Scheduled inspection overdue: ${alert.assetName}`
        : alert.kind === 'interval-overdue'
          ? `Inspection interval exceeded: ${alert.assetName}`
          : alert.kind === 'missing-completion'
            ? `Inspection completion time missing: ${alert.assetName}`
            : alert.kind === 'no-baseline'
              ? `Inspection baseline missing: ${alert.assetName}`
              : `No inspection regime: ${alert.assetName}`,
    summary: alert.detail,
    evidence: [
      alert.dueAt ? `Due: ${formatDate(alert.dueAt)}` : 'Due date: not calculable',
      alert.days !== null ? `Days ${alert.kind.includes('overdue') ? 'overdue' : 'until due'}: ${alert.days}` : 'Days: not available',
      alert.inspectionId ? `Inspection record: ${alert.inspectionId}` : 'No inspection record linked',
    ],
    limitations: [
      'Inspection records only show what has been entered; work done without a record cannot be confirmed.',
      'This alert does not establish that the asset is unsafe.',
    ],
    subjectIds: [alert.assetId, ...(alert.inspectionId ? [alert.inspectionId] : [])],
    facts: {
      alertKind: alert.kind,
      assetId: alert.assetId,
      assetName: alert.assetName,
      inspectionId: alert.inspectionId,
      dueAt: alert.dueAt,
      days: alert.days,
      detail: alert.detail,
    },
  }
}

export function analyseMaintenance(
  rooms: Room[],
  buildings: Building[],
  assets: Asset[],
  inspections: Inspection[],
  complaints: Complaint[],
  urbanIssues: UrbanIssue[],
  urbanAssets: UrbanAsset[],
  asOf: string,
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
): MaintenanceAnalysis {
  const roomById = new Map(rooms.map((room) => [room.id, room]))
  const buildingById = new Map(buildings.map((building) => [building.id, building]))
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))

  const keysById = new Map<string, string>()
  for (const complaint of complaints) {
    const key = repeatKey(complaint)
    if (key) keysById.set(complaint.id, key)
  }

  const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 } as Record<Severity, number>
  const byStatus = { open: 0, in_progress: 0, resolved: 0, closed: 0 } as Record<ComplaintStatus, number>
  const ranked: ComplaintPriority[] = []

  for (const complaint of complaints) {
    bySeverity[complaint.severity] += 1
    byStatus[complaint.status] += 1
    const active = complaint.status === 'open' || complaint.status === 'in_progress'
    if (!active) continue
    const target = targetForComplaint(complaint, roomById, buildingById, assetById)
    const repeatCount = countEarlierRepeats(complaint, complaints, keysById)
    const ageDays = daysSince(complaint.raisedAt, asOf)
    const peoplePoints =
      complaint.peopleAffected === null
        ? 0
        : Math.min(15, Math.floor(complaint.peopleAffected / 10) * weights.usersAffected)
    const agePoints = Math.min(15, Math.floor(ageDays / 3) * weights.daysOpen)
    const repeatPoints = Math.min(15, repeatCount * 5)
    const asset = complaint.assetId ? assetById.get(complaint.assetId) : undefined
    const assetPoints = asset
      ? (asset.criticality === 'critical' ? 8 : asset.criticality === 'high' ? 4 : 0) +
        (asset.condition === 'poor' ? weights.condition : 0)
      : 0

    const components: PriorityComponent[] = [
      {
        key: 'severity',
        label: 'Reported severity',
        points: Math.round(weights.severity * SEVERITY_RATIO[complaint.severity]),
        available: true,
        detail: severityLabel(complaint.severity),
      },
      {
        key: 'status',
        label: 'Status',
        points: STATUS_POINTS[complaint.status as 'open' | 'in_progress'],
        available: true,
        detail: statusLabel(complaint.status),
      },
      {
        key: 'people',
        label: 'People affected',
        points: peoplePoints,
        available: complaint.peopleAffected !== null,
        detail:
          complaint.peopleAffected === null
            ? 'Not recorded - not scored'
            : `${complaint.peopleAffected} reported affected (${weights.usersAffected} point${weights.usersAffected === 1 ? '' : 's'} per 10, maximum 15)`,
      },
      {
        key: 'age',
        label: 'Age',
        points: agePoints,
        available: true,
        detail: `${ageDays} days since raised (${weights.daysOpen} point${weights.daysOpen === 1 ? '' : 's'} per 3 days, maximum 15)`,
      },
      {
        key: 'repeat',
        label: 'Repeat pattern',
        points: repeatPoints,
        available: Boolean(keysById.get(complaint.id)),
        detail: !keysById.get(complaint.id)
          ? 'No linked target - repeat matching unavailable'
          : `${repeatCount} earlier matching report${repeatCount === 1 ? '' : 's'} within ${REPEAT_WINDOW_DAYS} days`,
      },
      {
        key: 'asset',
        label: 'Linked asset risk',
        points: assetPoints,
        available: Boolean(asset),
        detail: asset
          ? `${asset.name}: criticality ${asset.criticality ?? 'not recorded'}, condition ${asset.condition ?? 'not recorded'}`
          : 'No linked asset',
      },
    ]
    const score = components.reduce((sum, component) => sum + component.points, 0)
    const band = bandFor(score)
    ranked.push({
      complaintId: complaint.id,
      description: complaint.description,
      category: complaint.category,
      severity: complaint.severity,
      status: complaint.status,
      targetType: target.type,
      targetId: target.id,
      targetLabel: target.label,
      raisedAt: complaint.raisedAt,
      ageDays,
      assignedToUserId: complaint.assignedToUserId,
      score,
      band,
      bandLabel: BAND_LABELS[band],
      components,
      repeatCount,
      peopleAffected: complaint.peopleAffected,
    })
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.ageDays !== a.ageDays) return b.ageDays - a.ageDays
    return a.complaintId.localeCompare(b.complaintId)
  })

  const repeats = buildRepeatGroups(complaints, roomById, buildingById, assetById)
  const publicRepeats = buildPublicRepeats(urbanIssues, new Map(urbanAssets.map((asset) => [asset.id, asset])))
  const alerts = inspectionAlerts(assets, inspections, asOf)
  const findings: Finding[] = []

  for (const priority of ranked) {
    if (priority.band !== 'P1' && priority.band !== 'P2') continue
    const severity: FindingSeverity =
      priority.severity === 'critical' ? 'critical' : 'high'
    const repeat = priority.components.find((component) => component.key === 'repeat')
    findings.push({
      id: `maintenance-${priority.complaintId}`,
      module: 'maintenance',
      severity,
      title: `${priority.bandLabel} complaint: ${priority.description.slice(0, 90)}${priority.description.length > 90 ? '…' : ''}`,
      summary:
        `Priority score ${priority.score} (${priority.bandLabel}) for ${priority.category.toLowerCase()} at ${priority.targetLabel}. ` +
        `${priority.status === 'open' ? 'Open' : 'In progress'}, raised ${priority.ageDays} days ago.`,
      evidence: priority.components.map(
        (component) => `${component.label}: ${component.points} point${component.points === 1 ? '' : 's'} (${component.available ? component.detail : 'unavailable'})`,
      ),
      limitations: [
        'The priority score is a guide to what to look at first, built from recorded fields; it is not a safety assessment or a service-level guarantee.',
        repeat && !repeat.available ? 'Repeat matching is unavailable because no room or asset is linked.' : 'Unrecorded effects and site conditions may change the correct response.',
        'The demonstration workspace is synthetic.',
      ],
      subjectIds: [priority.complaintId, ...(priority.targetId ? [priority.targetId] : [])],
      facts: {
        complaintId: priority.complaintId,
        category: priority.category,
        severity: priority.severity,
        status: priority.status,
        targetLabel: priority.targetLabel,
        ageDays: priority.ageDays,
        peopleAffected: priority.peopleAffected,
        repeatCount: priority.repeatCount,
        score: priority.score,
        band: priority.band,
        components: priority.components,
      },
    })
  }

  for (const repeat of repeats) {
    const group = repeat.recordIds
      .map((id) => complaints.find((complaint) => complaint.id === id))
      .filter((complaint): complaint is Complaint => Boolean(complaint))
    const worst = group.reduce<Severity>(
      (current, complaint) => (severityRank(complaint.severity) > severityRank(current) ? complaint.severity : current),
      'low',
    )
    findings.push({
      id: repeat.id,
      module: 'maintenance',
      severity: repeat.openCount === 0 ? 'low' : worst === 'critical' || worst === 'high' ? 'high' : 'medium',
      title: `Repeat ${repeat.category.toLowerCase()} issues: ${repeat.targetLabel}`,
      summary:
        `${repeat.count} reports with the same target and category were recorded within ${REPEAT_WINDOW_DAYS} days ` +
        `(${repeat.openCount} still active). The latest was raised on ${formatDate(repeat.lastAt)}.`,
      evidence: group.map(
        (complaint) => `${formatDate(complaint.raisedAt)} · ${severityLabel(complaint.severity)} · ${complaint.status.replace('_', ' ')} · ${complaint.id}`,
      ),
      limitations: [
        'A repeated report may indicate an unresolved cause or duplicated reporting; the records do not establish which.',
        'Only reports linked to the same room or asset and category are grouped.',
      ],
      subjectIds: [repeat.targetId ?? 'unlinked', ...repeat.recordIds],
      facts: {
        repeatId: repeat.id,
        targetLabel: repeat.targetLabel,
        category: repeat.category,
        count: repeat.count,
        openCount: repeat.openCount,
        windowDays: repeat.windowDays,
        firstAt: repeat.firstAt,
        lastAt: repeat.lastAt,
      },
    })
  }

  for (const repeat of publicRepeats) {
    findings.push({
      id: repeat.id,
      module: 'maintenance',
      severity: repeat.openCount > 0 ? 'medium' : 'low',
      title: `Repeat public issue: ${repeat.category} at ${repeat.targetLabel}`,
      summary: `${repeat.count} public reports were recorded within ${REPEAT_WINDOW_DAYS} days (${repeat.openCount} still open).`,
      evidence: repeat.recordIds.map((id) => `Public issue ${id}`),
      limitations: [
        'Public reports are user-submitted and have not been verified by the responsible authority.',
        'Grouping uses the recorded asset or location label and category.',
      ],
      subjectIds: [repeat.targetId ?? 'public', ...repeat.recordIds],
      facts: { ...repeat },
    })
  }

  for (const alert of alerts) {
    const finding = inspectionFinding(alert)
    if (finding) findings.push(finding)
  }

  for (const issue of urbanIssues) {
    if (issue.status === 'resolved' || issue.status === 'closed') continue
    if (issue.severity !== 'critical' && issue.severity !== 'high') continue
    const authority = issue.authority ?? 'authority not recorded'
    findings.push({
      id: `public-${issue.id}`,
      module: 'maintenance',
      severity: issue.severity,
      title: `Open public issue: ${issue.category} at ${issue.locationLabel}`,
      summary:
        `A ${issue.severity}-severity public report is ${issue.status.replace('_', ' ')}. ` +
        `Responsible authority: ${authority}. Reported ${daysSince(issue.reportedAt, asOf)} days ago.`,
      evidence: [
        issue.description,
        `Location: ${issue.locationLabel}`,
        `Reported: ${formatDate(issue.reportedAt)}`,
        `Status: ${issue.status.replace('_', ' ')}`,
        `Authority: ${authority}`,
      ],
      limitations: [
        'This is a user-submitted public report; MicroCity has not verified the condition on site.',
        'Ownership by the named authority is as recorded and may need confirmation.',
      ],
      subjectIds: [issue.id, ...(issue.urbanAssetId ? [issue.urbanAssetId] : [])],
      facts: {
        issueId: issue.id,
        category: issue.category,
        severity: issue.severity,
        location: issue.locationLabel,
        authority: issue.authority,
        status: issue.status,
        reportedAt: issue.reportedAt,
        ageDays: daysSince(issue.reportedAt, asOf),
      },
    })
  }

  return {
    ranked,
    activeCount: ranked.length,
    closedCount: complaints.length - ranked.length,
    bySeverity,
    byStatus,
    repeats,
    publicRepeats,
    inspectionAlerts: alerts,
    overdueInspectionCount: alerts.filter((alert) => alert.kind === 'overdue' || alert.kind === 'interval-overdue').length,
    dueSoonInspectionCount: alerts.filter((alert) => alert.kind === 'due-soon' || alert.kind === 'interval-due-soon').length,
    openPublicIssues: urbanIssues.filter((issue) => issue.status === 'reported' || issue.status === 'in_progress').length,
    findings,
    methods: methodsFor(weights),
  }
}

function severityRank(value: Severity): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[value]
}
