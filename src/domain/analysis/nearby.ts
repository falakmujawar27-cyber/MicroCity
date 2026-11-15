import { NEARBY_TYPE_LABELS } from '../types.ts'
import type { NearbyAsset, NearbyAssetType } from '../types.ts'
import { NEEDS_STATUS_LABELS, type NeedsCategoryStatus } from './needs-categories.ts'
import type { Finding } from './types.ts'

export const NEARBY_RULE_LABEL = 'Project assumption (not a published norm)'
export const NEARBY_RULE = 'No records, or no recorded conditions, means Not enough data. Among assets with a recorded condition: all Good means Adequate; half or more Poor means Critical; otherwise any Fair or Poor means Stressed. Not recorded conditions are excluded from the denominator and shown separately. Daily users never decide status; they only order nearby types within the same status. Totals are asset-use estimates, not distinct people.'

export function formatNearbyUsersMethod(method: string | null): string {
  const text = method?.trim() || 'Not entered'
  return `${text.replace(/\.+$/, '')}.`
}

export function formatMissingNearbyUserCount(count: number): string {
  return `${count} ${count === 1 ? 'record has' : 'records have'} no user estimate.`
}

export interface NearbyRow {
  type: NearbyAssetType
  label: string
  records: NearbyAsset[]
  total: number
  good: number
  fair: number
  poor: number
  unknown: number
  recorded: number
  dailyUsers: number | null
  usersMissing: number
  status: NeedsCategoryStatus
  statusLabel: string
  demand: string
}

export function analyseNearby(assets: NearbyAsset[]): NearbyRow[] {
  return (Object.entries(NEARBY_TYPE_LABELS) as [NearbyAssetType, string][]).map(([type, label]) => {
    const records = assets.filter((asset) => asset.type === type)
    const good = records.filter((asset) => asset.condition === 'good').length
    const fair = records.filter((asset) => asset.condition === 'fair').length
    const poor = records.filter((asset) => asset.condition === 'poor').length
    const recorded = good + fair + poor
    const unknown = records.length - recorded
    const users = records.flatMap((asset) => asset.dailyUsers === null ? [] : [asset.dailyUsers])
    const dailyUsers = users.length ? users.reduce((sum, value) => sum + value, 0) : null
    const usersMissing = records.length - users.length
    const status: NeedsCategoryStatus = recorded === 0 ? 'not_enough_data'
      : poor * 2 >= recorded ? 'critical'
      : fair + poor > 0 ? 'stressed' : 'adequate'
    return {
      type, label, records, total: records.length, good, fair, poor, unknown, recorded,
      dailyUsers, usersMissing, status, statusLabel: NEEDS_STATUS_LABELS[status],
      demand: `${poor} Poor · ${fair} Fair · ${good} Good · ${unknown} of ${records.length} not recorded; estimated daily users: ${dailyUsers === null ? 'Not entered' : `${dailyUsers}${usersMissing ? ' (partial)' : ''}`}`,
    }
  })
}

const STATUS_ORDER: Record<NeedsCategoryStatus, number> = { critical: 0, stressed: 1, adequate: 2, not_enough_data: 3 }

export function rankNearby(rows: NearbyRow[]): NearbyRow[] {
  return [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || (b.dailyUsers ?? -1) - (a.dailyUsers ?? -1) || a.label.localeCompare(b.label))
}

export function nearbyFindings(rows: NearbyRow[]): Finding[] {
  return rankNearby(rows).filter((row) => row.status === 'critical' || row.status === 'stressed').map((row) => ({
    id: `nearby-${row.type}`,
    module: 'maintenance',
    severity: row.status === 'critical' ? 'critical' : 'high',
    title: `${row.label} near the college gate`,
    summary: row.demand,
    evidence: [NEARBY_RULE_LABEL, `${row.poor} Poor out of ${row.recorded} recorded conditions.`,
      ...row.records.map((asset) => `${asset.id}: ${asset.locationDescription}; ${asset.basis}; users: ${asset.dailyUsers ?? 'Not entered'}; how obtained: ${asset.usersMethod ?? 'Not entered'}`)],
    limitations: [NEARBY_RULE, 'Authority reporting needs a human review and submission; nothing is sent automatically.'],
    subjectIds: [`nearby-type-${row.type}`, ...row.records.map((asset) => asset.id)],
    facts: { nearbyType: row.type, dailyUsers: row.dailyUsers, poor: row.poor, fair: row.fair, good: row.good, total: row.records.length, recorded: row.recorded, unknown: row.unknown },
  }))
}
