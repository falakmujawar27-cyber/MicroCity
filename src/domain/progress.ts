import type { Complaint } from './types.ts'

/** The four stages a campus report moves through, shown on the student's page. */
export const REPORT_STEPS = ['Reported', 'Assigned', 'In progress', 'Fixed'] as const

/** A close without a repair is not the same outcome as Fixed. */
export const CLOSED_WITHOUT_REPAIR = 'Closed without repair'

/**
 * A ticket closed after a repair keeps its resolution time and note, so it is
 * still Fixed. Only a close with no recorded resolution is without repair.
 */
export function wasRepaired(complaint: Pick<Complaint, 'resolvedAt' | 'completionNote'>): boolean {
  return Boolean(complaint.resolvedAt) || Boolean(complaint.completionNote?.trim())
}

/**
 * The progress line is derived from the recorded status and assignee, so it
 * moves when estates assigns the job and when maintenance starts or finishes
 * it. Nothing is stored twice. A closed report keeps the last step but names
 * the real outcome instead of claiming it was fixed.
 */
export function reportStage(complaint: Complaint): number {
  if (complaint.status === 'resolved' || complaint.status === 'closed') return 3
  if (complaint.status === 'in_progress') return 2
  if (complaint.assignedToUserId) return 1
  return 0
}

export function reportSteps(complaint: Complaint): readonly string[] {
  if (complaint.status !== 'closed' || wasRepaired(complaint)) return REPORT_STEPS
  return [...REPORT_STEPS.slice(0, 3), CLOSED_WITHOUT_REPAIR]
}

/**
 * The headline used on both the reporter's card and the technician's job card,
 * so the two screens never describe the same report differently.
 */
export function reportTitle(description: string): string {
  const firstSentence = description.split(/(?<=[.!?])\s/)[0] ?? description
  const cleaned = firstSentence.replace(/\s*\((?:invented|synthetic)[^)]*\)\s*$/i, '').trim()
  return cleaned.length > 90 ? `${cleaned.slice(0, 87).trimEnd()}…` : cleaned
}
