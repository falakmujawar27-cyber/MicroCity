/**
 * Maintenance job and inspection views served to the maintenance role.
 *
 * Nothing here calculates a new priority. The one-line reason and the Details
 * breakdown are both read from the existing triage score produced by
 * analyseMaintenance() in src/domain/analysis/maintenance.ts, so the screen and
 * the rest of the app can never disagree about what a job is worth.
 */
import {
  INSPECTION_DUE_SOON_DAYS,
  analyseMaintenance,
  type ComplaintPriority,
} from '../src/domain/analysis/maintenance.ts'
import type { InspectionCard, JobCard, JobGroup } from '../src/domain/jobs.ts'
import { reportTitle } from '../src/domain/progress.ts'
import type {
  Asset,
  Building,
  Complaint,
  ComplaintStatus,
  Inspection,
  Room,
  Severity,
} from '../src/domain/types.ts'
import { formatIstDate } from '../src/lib/time.ts'

export type { InspectionCard, JobCard, JobGroup } from '../src/domain/jobs.ts'

const DAY_MS = 86_400_000

const SEVERITY_WORDS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export function jobGroupOf(status: ComplaintStatus): JobGroup {
  if (status === 'open') return 'todo'
  if (status === 'in_progress') return 'progress'
  return 'done'
}

/**
 * The reason line quotes three values that already exist on the triage score:
 * the recorded severity, the age in days and the people-affected count. The
 * count is entered by the reporter, so it is named as reported rather than
 * estimated; when it was never recorded the line says so instead of implying
 * zero.
 */
function reasonLine(priority: ComplaintPriority): string {
  const age = `${priority.ageDays} ${priority.ageDays === 1 ? 'day' : 'days'} open`
  const people =
    priority.peopleAffected === null
      ? 'number affected not recorded'
      : `${priority.peopleAffected} ${priority.peopleAffected === 1 ? 'person' : 'people'} affected (as reported)`
  return `${SEVERITY_WORDS[priority.severity]}, ${age}, ${people}`
}

function daysBetween(from: string, to: string): number | null {
  const start = Date.parse(from)
  const end = Date.parse(to)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return Math.max(0, Math.floor((end - start) / DAY_MS))
}

export function buildJobCards(
  complaints: Complaint[],
  rooms: Room[],
  buildings: Building[],
  assets: Asset[],
  asOf: string,
  analysisScope: Complaint[] = complaints,
): JobCard[] {
  // Priority points and repeat counts must describe the whole college, even
  // when only one technician's jobs are being listed. The analysis runs over
  // analysisScope and only the listed complaints are turned into cards, so no
  // other person's job details can reach the board.
  const analysis = analyseMaintenance(rooms, buildings, assets, [], analysisScope, [], [], asOf)
  const priorityById = new Map(analysis.ranked.map((item) => [item.complaintId, item]))
  const roomById = new Map(rooms.map((room) => [room.id, room]))
  const buildingById = new Map(buildings.map((building) => [building.id, building]))
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))

  const cards = complaints.map((complaint) => {
    const priority = priorityById.get(complaint.id) ?? null
    const room = complaint.roomId ? roomById.get(complaint.roomId) : undefined
    const building =
      (room ? buildingById.get(room.buildingId) : undefined) ??
      (complaint.buildingId ? buildingById.get(complaint.buildingId) : undefined)
    const asset = complaint.assetId ? assetById.get(complaint.assetId) : undefined
    const place = priority
      ? priority.targetLabel
      : [building?.name, room ? `Room ${room.code}` : asset?.name].filter(Boolean).join(' · ') ||
        'Place not recorded'

    const group = jobGroupOf(complaint.status)
    const completionNote =
      typeof complaint.completionNote === 'string' && complaint.completionNote.trim()
        ? complaint.completionNote.trim()
        : null
    const completionPhotoName =
      typeof complaint.completionPhotoName === 'string' && complaint.completionPhotoName.trim()
        ? complaint.completionPhotoName.trim()
        : null
    // A close without repair records closedAt, not resolvedAt, so the done date
    // falls back to it without ever calling the job fixed.
    const finishedAt = complaint.resolvedAt ?? complaint.closedAt ?? null

    return {
      id: complaint.id,
      collegeId: complaint.collegeId,
      ticketNumber: complaint.ticketNumber ?? null,
      title: reportTitle(complaint.description),
      category: complaint.category,
      severity: complaint.severity,
      status: complaint.status,
      group,
      place,
      reason: priority ? reasonLine(priority) : `${SEVERITY_WORDS[complaint.severity]}, reported ${formatIstDate(complaint.raisedAt) ?? 'on a date not recorded'}`,
      priority: priority
        ? { score: priority.score, bandLabel: priority.bandLabel, components: priority.components }
        : null,
      openDays: priority
        ? priority.ageDays
        : finishedAt
          ? daysBetween(complaint.raisedAt, finishedAt)
          : daysBetween(complaint.raisedAt, asOf),
      peopleAffected: complaint.peopleAffected,
      raisedAt: complaint.raisedAt,
      raisedOn: formatIstDate(complaint.raisedAt),
      completedAt: finishedAt,
      completedOn: finishedAt ? formatIstDate(finishedAt) : null,
      completionNote,
      completionPhotoName,
      hasCompletionPhoto: Boolean(complaint.completionPhotoDataUrl),
      repaired: Boolean(complaint.resolvedAt) || Boolean(completionNote),
      closedReason:
        typeof complaint.closedReason === 'string' && complaint.closedReason.trim()
          ? complaint.closedReason.trim()
          : null,
      linkedAssetId: complaint.assetId,
    } satisfies JobCard
  })

  const groupOrder: Record<JobGroup, number> = { todo: 0, progress: 1, done: 2 }
  return cards.sort((a, b) => {
    if (groupOrder[a.group] !== groupOrder[b.group]) return groupOrder[a.group] - groupOrder[b.group]
    const scoreOf = (card: JobCard) => card.priority?.score ?? Number.NEGATIVE_INFINITY
    if (scoreOf(b) !== scoreOf(a)) return scoreOf(b) - scoreOf(a)
    return b.raisedAt.localeCompare(a.raisedAt)
  })
}

export function buildInspectionCards(
  inspections: Inspection[],
  assets: Asset[],
  asOf: string,
  nameOf: (userId: string | null) => string | null = () => null,
): InspectionCard[] {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const reference = Date.parse(asOf)

  const cards = inspections.map((inspection) => {
    const asset = assetById.get(inspection.assetId)
    const scheduled = inspection.scheduledFor ? Date.parse(inspection.scheduledFor) : NaN
    const days =
      !Number.isNaN(scheduled) && !Number.isNaN(reference)
        ? Math.floor((scheduled - reference) / DAY_MS)
        : null
    const due: InspectionCard['due'] =
      inspection.status === 'completed'
        ? 'completed'
        : inspection.status === 'cancelled'
          ? 'cancelled'
          : days !== null && days < 0
            ? 'overdue'
            : days !== null && days <= INSPECTION_DUE_SOON_DAYS
              ? 'due-soon'
              : 'later'
    return {
      id: inspection.id,
      assetId: inspection.assetId,
      assetName: asset?.name ?? 'Asset name not recorded',
      inspectorName: nameOf(inspection.inspectorUserId ?? null),
      status: inspection.status,
      scheduledFor: inspection.scheduledFor,
      scheduledOn: inspection.scheduledFor ? formatIstDate(inspection.scheduledFor) : null,
      completedOn: inspection.completedAt ? formatIstDate(inspection.completedAt) : null,
      findings: inspection.findings,
      result: inspection.result ?? null,
      days,
      due,
    } satisfies InspectionCard
  })

  const dueOrder = { overdue: 0, 'due-soon': 1, later: 2, completed: 3, cancelled: 4 }
  return cards.sort((a, b) => {
    if (dueOrder[a.due] !== dueOrder[b.due]) return dueOrder[a.due] - dueOrder[b.due]
    return String(a.scheduledFor ?? '9999').localeCompare(String(b.scheduledFor ?? '9999'))
  })
}

/** Inspections the technician still has to carry out, overdue first. */
export function inspectionsDue(cards: InspectionCard[]): InspectionCard[] {
  return cards.filter((card) => card.due === 'overdue' || card.due === 'due-soon' || card.due === 'later')
}
