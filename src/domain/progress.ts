import type { Complaint } from './types.ts'

/** The four stages a campus report moves through, shown on the student's page. */
export const REPORT_STEPS = ['Reported', 'Assigned', 'In progress', 'Fixed'] as const

/**
 * The progress line is derived from the recorded status and assignee, so it
 * moves when estates assigns the job and when maintenance starts or finishes
 * it. Nothing is stored twice.
 */
export function reportStage(complaint: Complaint): number {
  if (complaint.status === 'resolved' || complaint.status === 'closed') return 3
  if (complaint.status === 'in_progress') return 2
  if (complaint.assignedToUserId) return 1
  return 0
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
