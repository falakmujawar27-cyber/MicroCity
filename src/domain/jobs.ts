/**
 * Shapes shared by the maintenance job endpoints and the technician screens.
 *
 * The server sends these; the browser only renders them. The reason line and
 * the Details breakdown both come from the existing triage score, so the
 * technician sees the same numbers the staff screens see.
 */
import type { PriorityComponent } from './analysis/maintenance.ts'
import type { ComplaintStatus, InspectionResult, Severity } from './types.ts'

export type JobGroup = 'todo' | 'progress' | 'done'

export interface JobPriorityDetail {
  score: number
  bandLabel: string
  components: PriorityComponent[]
}

export interface JobCard {
  id: string
  ticketNumber: string | null
  title: string
  category: string
  severity: Severity
  status: ComplaintStatus
  group: JobGroup
  place: string
  /** Server-written sentence assembled from the existing priority points. */
  reason: string
  /** The same points the reason line is drawn from, for the Details panel. */
  priority: JobPriorityDetail | null
  openDays: number | null
  peopleAffected: number | null
  raisedAt: string
  raisedOn: string | null
  completedAt: string | null
  completedOn: string | null
  completionNote: string | null
  completionPhotoName: string | null
  hasCompletionPhoto: boolean
  linkedAssetId: string | null
}

export interface InspectionCard {
  id: string
  assetId: string
  assetName: string
  status: 'scheduled' | 'completed' | 'cancelled'
  scheduledFor: string | null
  scheduledOn: string | null
  completedOn: string | null
  findings: string | null
  result: InspectionResult | null
  /** Negative when the scheduled date has passed, positive when it is ahead. */
  days: number | null
  due: 'overdue' | 'due-soon' | 'later' | 'completed' | 'cancelled'
}

export interface JobBoard {
  jobs: JobCard[]
  counts: Record<JobGroup, number>
  inspections: InspectionCard[]
  inspectionsDue: number
  college: { id: string; name: string }
  serverTime: string
}
