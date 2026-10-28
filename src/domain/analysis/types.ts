/** Shared analysis vocabulary. All values come from deterministic code. */

export type AnalysisModule = 'capacity' | 'utilities' | 'maintenance' | 'plan' | 'data'

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface Finding {
  id: string
  module: AnalysisModule
  severity: FindingSeverity
  title: string
  summary: string
  evidence: string[]
  limitations: string[]
  subjectIds: string[]
  /** Compact computed facts for the AI explanation endpoint. */
  facts: Record<string, unknown>
}

export const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (rank !== 0) return rank
    return a.title.localeCompare(b.title)
  })
}

export function pct(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return 'Not available'
  return `${(value * 100).toFixed(digits)}%`
}
