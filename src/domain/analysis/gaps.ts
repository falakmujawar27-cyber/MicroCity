import { SEVERITY_RANK, sortFindings, type Finding } from './types.ts'

export interface GapItem extends Finding {
  noPlanYet: boolean
  findingIds: string[]
}

export function isCriticalGapItem(finding: Pick<Finding, 'id' | 'severity'>): boolean {
  // Public reports are counted separately under open issues, not as gap items.
  return finding.severity === 'critical' && !finding.id.startsWith('public-')
}

export function buildGapItems(sourceFindings: Finding[], matchedFindingIds: string[]): GapItem[] {
  const matched = new Set(matchedFindingIds)
  const items = new Map<string, GapItem>()
  for (const finding of sortFindings(sourceFindings)) {
    const key = `${finding.module}:${finding.subjectIds[0] ?? finding.id}`
    const previous = items.get(key)
    if (previous) {
      previous.findingIds.push(finding.id)
      previous.noPlanYet = previous.noPlanYet && !matched.has(finding.id)
    } else {
      items.set(key, { ...finding, findingIds: [finding.id], noPlanYet: !matched.has(finding.id) })
    }
  }
  return [...items.values()].sort((a, b) => {
    const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (severity !== 0) return severity
    const aNearby = typeof a.facts.nearbyType === 'string'
    const bNearby = typeof b.facts.nearbyType === 'string'
    if (aNearby && bNearby) {
      return Number(b.facts.dailyUsers ?? -1) - Number(a.facts.dailyUsers ?? -1) || a.title.localeCompare(b.title)
    }
    // Keep nearby items contiguous so user-count ordering is transitive.
    if (aNearby !== bNearby) return aNearby ? -1 : 1
    return a.title.localeCompare(b.title)
  })
}
