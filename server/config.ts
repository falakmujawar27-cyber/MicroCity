/**
 * Per-college configuration kept in the existing `meta` key/value table.
 *
 * Nothing here renames or rewrites domain records. Reads fall back to the
 * documented defaults when no administrator has saved a value, and every
 * write replaces one JSON value, so applying a saved configuration is
 * additive and idempotent.
 */
import type { Database } from './db.ts'
import { DEFAULT_PRIORITY_WEIGHTS } from '../src/domain/types.ts'
import type { NeedsLimitConfig, PriorityWeights, ThresholdKind } from '../src/domain/types.ts'

/**
 * Only a category whose rule consumes a limit may be configured. Rooms are
 * scored by the Needs Score; Lighting, Waste and Parking have no recorded
 * demand to compare, so this build has no rule for them.
 */
export const LIMIT_CATEGORIES = ['water'] as const
export type LimitCategory = (typeof LIMIT_CATEGORIES)[number]

export const THRESHOLD_KINDS: ThresholdKind[] = ['published_norm', 'project_assumption']

const NEEDS_LIMITS_KEY = (collegeId: string) => `needsLimits:${collegeId}`
const PRIORITY_WEIGHTS_KEY = (collegeId: string) => `priorityWeights:${collegeId}`

function isLimitCategory(value: string): value is LimitCategory {
  return (LIMIT_CATEGORIES as readonly string[]).includes(value)
}

function isThresholdKind(value: unknown): value is ThresholdKind {
  return typeof value === 'string' && (THRESHOLD_KINDS as string[]).includes(value)
}

function validStoredLimit(value: unknown): value is NeedsLimitConfig {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.category === 'string' &&
    isLimitCategory(entry.category) &&
    typeof entry.limit === 'number' &&
    Number.isFinite(entry.limit) &&
    entry.limit > 0 &&
    typeof entry.unit === 'string' &&
    entry.unit.trim() !== '' &&
    typeof entry.source === 'string' &&
    entry.source.trim() !== '' &&
    isThresholdKind(entry.kind) &&
    typeof entry.updatedAt === 'string' &&
    typeof entry.updatedByName === 'string'
  )
}

export function readNeedsLimits(db: Database, collegeId: string): NeedsLimitConfig[] {
  const raw = db.getMeta(NEEDS_LIMITS_KEY(collegeId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(validStoredLimit)
  } catch {
    return []
  }
}

export function saveNeedsLimit(db: Database, collegeId: string, config: NeedsLimitConfig): void {
  const current = readNeedsLimits(db, collegeId).filter((entry) => entry.category !== config.category)
  db.setMeta(NEEDS_LIMITS_KEY(collegeId), JSON.stringify([...current, config]))
}

function validStoredWeights(value: unknown): value is PriorityWeights {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  const keys = ['severity', 'condition', 'usersAffected', 'daysOpen'] as const
  return keys.every((key) => typeof entry[key] === 'number' && Number.isFinite(entry[key]))
}

export function readPriorityWeights(db: Database, collegeId: string): PriorityWeights {
  const raw = db.getMeta(PRIORITY_WEIGHTS_KEY(collegeId))
  if (!raw) return { ...DEFAULT_PRIORITY_WEIGHTS }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!validStoredWeights(parsed)) return { ...DEFAULT_PRIORITY_WEIGHTS }
    return {
      severity: parsed.severity,
      condition: parsed.condition,
      usersAffected: parsed.usersAffected,
      daysOpen: parsed.daysOpen,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      updatedByName: typeof parsed.updatedByName === 'string' ? parsed.updatedByName : null,
    }
  } catch {
    return { ...DEFAULT_PRIORITY_WEIGHTS }
  }
}

export function savePriorityWeights(db: Database, collegeId: string, weights: PriorityWeights): void {
  db.setMeta(PRIORITY_WEIGHTS_KEY(collegeId), JSON.stringify(weights))
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

export function parseNeedsLimit(
  category: string,
  body: Record<string, unknown>,
): ParseResult<{ limit: number; unit: string; source: string; kind: ThresholdKind }> {
  if (!isLimitCategory(category)) {
    return {
      ok: false,
      error: 'No rule in this build takes a limit for that category. Only Water compares recorded consumption with a limit.',
    }
  }
  const limit = typeof body.limit === 'number' ? body.limit : Number.NaN
  if (!Number.isFinite(limit) || limit <= 0) {
    return { ok: false, error: 'Enter a limit greater than zero.' }
  }
  const unit = typeof body.unit === 'string' ? body.unit.trim() : ''
  if (!unit) return { ok: false, error: 'Enter the unit for this limit, for example m3.' }
  if (unit.length > 24) return { ok: false, error: 'The unit must be 24 characters or fewer.' }
  const source = typeof body.source === 'string' ? body.source.trim() : ''
  if (!source) {
    return { ok: false, error: 'A source is required. Name where the limit comes from; it is shown beside the number.' }
  }
  if (source.length > 200) return { ok: false, error: 'The source must be 200 characters or fewer.' }
  if (!isThresholdKind(body.kind)) {
    return { ok: false, error: 'Choose whether the limit is a published norm or a project assumption.' }
  }
  return { ok: true, value: { limit, unit, source, kind: body.kind } }
}

export function parsePriorityWeightsInput(
  body: Record<string, unknown>,
): ParseResult<{ severity: number; condition: number; usersAffected: number; daysOpen: number }> {
  const keys = ['severity', 'condition', 'usersAffected', 'daysOpen'] as const
  const values: Record<string, number> = {}
  for (const key of keys) {
    const value = body[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, error: `Enter a number for ${key === 'usersAffected' ? 'users affected' : key === 'daysOpen' ? 'days open' : key}.` }
    }
    if (value < 0 || value > 100) {
      return { ok: false, error: 'Each weight must be between 0 and 100 points.' }
    }
    values[key] = value
  }
  const total = keys.reduce((sum, key) => sum + values[key], 0)
  if (total <= 0) {
    return { ok: false, error: 'At least one weight must be greater than zero.' }
  }
  return {
    ok: true,
    value: {
      severity: values.severity,
      condition: values.condition,
      usersAffected: values.usersAffected,
      daysOpen: values.daysOpen,
    },
  }
}
