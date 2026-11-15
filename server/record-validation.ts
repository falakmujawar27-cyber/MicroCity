/**
 * Server-side validation and authorisation for every business record.
 * The client mirrors some checks for convenience, but these rules are the
 * authority: cross-college references, role restrictions, transitions,
 * duplicate keys and safe-deletion guards are all enforced here.
 */
import { randomUUID } from 'node:crypto'
import { ENTITY_BY_NAME, type EntitySpec, type FieldSpec } from '../src/domain/entities.ts'
import { complaintDescriptionError } from '../src/domain/complaint-rules.ts'
import { hasCapability } from '../src/domain/permissions.ts'
import type { ComplaintStatus, UserRole } from '../src/domain/types.ts'
import type { Database, StoredRecord } from './db.ts'

export interface Actor {
  id: string
  displayName: string
  role: UserRole
}

export interface ValidationContext {
  db: Database
  actor: Actor
  collegeId: string
  mode: 'ui' | 'import'
}

export type ValidationResult =
  | { ok: true; record: Record<string, unknown>; meta: RecordMeta }
  | { ok: false; error: string; fieldErrors: Record<string, string> }

export interface RecordMeta {
  statusChange?: { from: ComplaintStatus; to: ComplaintStatus }
  assignedChange?: { from: string | null; to: string | null }
  categoryChange?: { from: string; to: string }
  note?: string
  replaced?: number
}

const PREFIX: Record<string, string> = {
  buildings: 'bld',
  rooms: 'rm',
  timetableSlots: 'tlt',
  assets: 'ast',
  inspections: 'ins',
  utilityMeters: 'mtr',
  utilityReadings: 'rea',
  tariffs: 'trf',
  complaints: 'cmp',
  planOptions: 'opt',
  nearbyAssets: 'near',
  urbanAssets: 'ua',
  urbanIssues: 'ui',
}

const SEVERITY = ['low', 'medium', 'high', 'critical']

export function canCreate(entity: string, ctx: ValidationContext): boolean {
  if (entity === 'urbanAssets' || entity === 'nearbyAssets') return ctx.actor.role === 'admin'
  if (entity === 'urbanIssues' || entity === 'complaints') return true
  return hasCapability(ctx.actor.role, 'manage-inventory')
}

export function canUpdate(record: StoredRecord, ctx: ValidationContext): boolean {
  const { entity } = record
  if (entity === 'complaints') {
    if (ctx.actor.role === 'admin' || ctx.actor.role === 'estates') return true
    if (ctx.actor.role === 'maintenance') {
      return String(record.data.assignedToUserId ?? '') === ctx.actor.id
    }
    return false
  }
  if (entity === 'inspections' && ctx.actor.role === 'maintenance') {
    return String(record.data.inspectorUserId ?? '') === ctx.actor.id
  }
  if (entity === 'urbanIssues') return hasCapability(ctx.actor.role, 'update-urban-issues')
  if (entity === 'urbanAssets' || entity === 'nearbyAssets') return ctx.actor.role === 'admin'
  return hasCapability(ctx.actor.role, 'manage-inventory')
}

export function canDelete(record: StoredRecord, ctx: ValidationContext): boolean {
  if (record.entity === 'complaints' || record.entity === 'urbanAssets' || record.entity === 'urbanIssues' || record.entity === 'nearbyAssets') {
    return ctx.actor.role === 'admin'
  }
  return hasCapability(ctx.actor.role, 'manage-inventory')
}

/* ------------------------------------------------------------------ */
/* Scalar normalisation                                               */
/* ------------------------------------------------------------------ */

function fail(errors: Record<string, string>, key: string, message: string): null {
  errors[key] = errors[key] ?? message
  return null
}

function normaliseField(field: FieldSpec, raw: unknown, errors: Record<string, string>): unknown {
  const isNullable = field.type.startsWith('nullable-') || !field.required
  const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')
  if (empty) {
    if (field.required) return fail(errors, field.key, `${field.label} is required.`)
    return null
  }

  if (field.type.endsWith('enum')) {
    const value = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_')
    if (!field.enumValues?.includes(value)) {
      return fail(errors, field.key, `${field.label} must be one of: ${field.enumValues?.join(', ')}.`)
    }
    return value
  }

  if (field.type === 'iso-date' || field.type === 'nullable-iso-date') {
    const text = String(raw).trim()
    const candidate = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text
    const time = Date.parse(candidate)
    if (Number.isNaN(time)) return fail(errors, field.key, `${field.label} must be an ISO 8601 date.`)
    return new Date(time).toISOString()
  }

  if (field.type.includes('number') || field.type.includes('integer')) {
    const value = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''))
    if (!Number.isFinite(value)) return fail(errors, field.key, `${field.label} must be a number.`)
    if (value < 0) return fail(errors, field.key, `${field.label} cannot be negative.`)
    if (field.type.includes('integer') && !Number.isInteger(value)) {
      return fail(errors, field.key, `${field.label} must be a whole number.`)
    }
    return value
  }

  const value = String(raw).trim()
  if (value.length === 0) {
    if (field.required) return fail(errors, field.key, `${field.label} is required.`)
    return null
  }
  if (value.length > 4000) return fail(errors, field.key, `${field.label} is too long.`)
  if (!isNullable && field.required && value.length === 0) {
    return fail(errors, field.key, `${field.label} is required.`)
  }
  return value
}

function normaliseGeneric(spec: EntitySpec, raw: Record<string, unknown>, errors: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of spec.fields) {
    out[field.key] = normaliseField(field, raw[field.key], errors)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Relationship helpers                                               */
/* ------------------------------------------------------------------ */

function recordInCollege(db: Database, id: string, entity: string, collegeId: string | null): StoredRecord | null {
  const record = db.getRecord(id)
  if (!record || record.entity !== entity) return null
  if (record.collegeId !== collegeId) return null
  return record
}

export function validPhoto(raw: Record<string, unknown>, errors: Record<string, string>): { name: string | null; dataUrl: string | null } {
  let name = raw.photoName == null || String(raw.photoName).trim() === '' ? null : String(raw.photoName).trim()
  let dataUrl =
    raw.photoDataUrl == null || String(raw.photoDataUrl).trim() === '' ? null : String(raw.photoDataUrl)
  if (name && name.length > 160) name = name.slice(0, 160)
  if (dataUrl) {
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) {
      fail(errors, 'photoDataUrl', 'Photo must be a PNG, JPEG or WebP image.')
      dataUrl = null
    } else if (dataUrl.length > 1_500_000) {
      fail(errors, 'photoDataUrl', 'Photo is too large (maximum about 1.1 MB).')
      dataUrl = null
    }
  }
  return { name, dataUrl }
}

export function naturalKey(entity: string, data: Record<string, unknown>): string | null {
  const s = (key: string) => {
    const value = data[key]
    return value === null || value === undefined || value === '' ? null : String(value).trim().toLowerCase()
  }
  switch (entity) {
    case 'buildings': return s('name') ? `buildings:${s('name')}` : null
    case 'rooms': return s('buildingId') && s('code') ? `rooms:${s('buildingId')}:${s('code')}` : null
    case 'timetableSlots': return s('roomId') && s('startsAt') ? `timetable:${s('roomId')}:${s('startsAt')}:${s('endsAt')}` : null
    case 'assets': return s('name') ? `assets:${s('name')}` : null
    case 'inspections': return s('assetId') && s('scheduledFor') ? `inspections:${s('assetId')}:${s('scheduledFor')}` : null
    case 'utilityMeters': return s('buildingId') && s('label') ? `meters:${s('buildingId')}:${s('label')}` : null
    case 'utilityReadings': return s('meterId') && s('readAt') ? `readings:${s('meterId')}:${s('readAt')}` : null
    case 'tariffs': return s('utility') && s('effectiveFrom') ? `tariffs:${s('utility')}:${s('effectiveFrom')}` : null
    case 'complaints': return s('raisedAt') && s('description') ? `complaints:${s('raisedAt')}:${s('description')}` : null
    case 'planOptions': return s('title') ? `options:${s('title')}` : null
    case 'urbanAssets': return (s('category') && (s('locationLabel') ?? s('name'))) ? `urbanAssets:${s('category')}:${s('locationLabel') ?? s('name')}` : null
    case 'urbanIssues': return (s('reportedAt') && s('category')) ? `urbanIssues:${s('urbanAssetId') ?? ''}:${s('reportedAt')}:${s('category')}` : null
    default: return null
  }
}

function duplicateKey(
  db: Database,
  entity: string,
  collegeId: string | null,
  data: Record<string, unknown>,
  exceptId?: string,
): boolean {
  const key = naturalKey(entity, data)
  if (!key) return false
  const existing = entity === 'urbanAssets' || entity === 'urbanIssues'
    ? db.listRecords(entity, null)
    : db.listRecords(entity, collegeId)
  return existing.some((r) => r.id !== exceptId && naturalKey(entity, r.data) === key)
}

export function deletionGuard(db: Database, record: StoredRecord): string | null {
  const id = record.id
  const refs = (entity: string, key: string, collegeId: string | null) =>
    (collegeId === null ? db.listRecords(entity, null) : db.listRecords(entity, collegeId))
      .filter((r) => String(r.data[key] ?? '') === id)
  if (record.entity === 'buildings') {
    if (refs('rooms', 'buildingId', record.collegeId).length) return 'This building still has rooms. Remove or reassign those rooms first.'
    if (refs('utilityMeters', 'buildingId', record.collegeId).length) return 'This building still has utility meters. Remove those meters first.'
  }
  if (record.entity === 'rooms') {
    if (refs('timetableSlots', 'roomId', record.collegeId).length) return 'This room still has timetable bookings. Remove them first.'
    if (refs('complaints', 'roomId', record.collegeId).length) return 'Complaints reference this room. Close or reassign them before deletion.'
  }
  if (record.entity === 'assets') {
    if (refs('complaints', 'assetId', record.collegeId).length) return 'Complaints reference this asset. Resolve or reassign them first.'
    if (refs('inspections', 'assetId', record.collegeId).length) return 'Inspections reference this asset. Remove those inspection records first.'
  }
  if (record.entity === 'utilityMeters') {
    if (refs('utilityReadings', 'meterId', record.collegeId).length) return 'This meter still has readings. Remove those readings first.'
  }
  if (record.entity === 'planOptions') {
    if (refs('decisions', 'optionId', record.collegeId).length) return 'A recorded decision references this option. Decisions are retained for audit.'
  }
  if (record.entity === 'urbanAssets') {
    if (refs('urbanIssues', 'urbanAssetId', null).length) return 'Public issues reference this asset. Resolve or unlink them first.'
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Entity-specific validation                                         */
/* ------------------------------------------------------------------ */

function validateComplaintTargets(
  db: Database,
  data: Record<string, unknown>,
  collegeId: string | null,
  errors: Record<string, string>,
  inBatch?: Set<string>,
  options: { requireBuilding?: boolean } = {},
): void {
  const requireBuilding = options.requireBuilding === true
  const buildingId = data.buildingId ? String(data.buildingId) : null
  const roomChoice = data.roomChoice ? String(data.roomChoice) : null
  const roomId = data.roomId ? String(data.roomId) : null
  const assetId = data.assetId ? String(data.assetId) : null

  if (requireBuilding && !buildingId) {
    fail(errors, 'buildingId', 'Choose the building this complaint is about.')
  }
  if (requireBuilding && !roomChoice) {
    fail(errors, 'roomChoice', 'Say whether the room is known.')
  }
  if (buildingId && !recordInCollege(db, buildingId, 'buildings', collegeId) && !inBatch?.has(`buildings:${buildingId}`)) {
    fail(errors, 'buildingId', 'That building does not exist in this college.')
  }

  if (roomChoice === 'room' && !roomId) {
    fail(errors, 'roomId', 'Choose the room, or mark that you are not sure.')
  }
  if (roomChoice === 'not_sure' && roomId) {
    fail(errors, 'roomId', 'Remove the room, or change "Room known" to room.')
  }

  if (roomId && assetId) {
    fail(errors, 'roomId', 'A complaint can target a room or an asset, not both.')
    return
  }

  if (roomId) {
    const room = recordInCollege(db, roomId, 'rooms', collegeId)
    if (!room && !inBatch?.has(`rooms:${roomId}`)) {
      fail(errors, 'roomId', 'That room does not exist in this college.')
    } else if (room && buildingId && String(room.data.buildingId) !== buildingId) {
      fail(errors, 'roomId', 'That room is in a different building. Choose a room in the selected building.')
    }
  }

  if (assetId) {
    const asset = recordInCollege(db, assetId, 'assets', collegeId)
    if (!asset && !inBatch?.has(`assets:${assetId}`)) {
      fail(errors, 'assetId', 'That asset does not exist in this college.')
    } else if (asset && buildingId && asset.data.buildingId && String(asset.data.buildingId) !== buildingId) {
      fail(errors, 'assetId', 'That asset is in a different building. Choose one in the selected building, or a campus-wide asset.')
    }
  }
}

export function createEntityRecord(
  entity: string,
  rawInput: Record<string, unknown>,
  ctx: ValidationContext,
  options: { inBatchIds?: Set<string> } = {},
): ValidationResult {
  const spec = ENTITY_BY_NAME.get(entity)
  if (!spec) return { ok: false, error: `Unknown record type "${entity}".`, fieldErrors: {} }
  if (!canCreate(entity, ctx)) {
    return { ok: false, error: 'Your role cannot create this kind of record.', fieldErrors: {} }
  }

  const raw = { ...rawInput }
  const at = new Date().toISOString()
  if (entity === 'complaints' && ctx.mode === 'ui') {
    raw.status = 'open'
    raw.raisedAt = at
    raw.resolvedAt = null
    raw.assignedToUserId = null
  }
  if (entity === 'urbanIssues' && ctx.mode === 'ui') {
    raw.status = 'reported'
    raw.reportedAt = at
  }
  if (entity === 'nearbyAssets' && raw.distanceBasis == null) raw.distanceBasis = 'estimated'
  const errors: Record<string, string> = {}
  if (entity === 'complaints') {
    if (raw.buildingId === undefined || raw.buildingId === null || String(raw.buildingId).trim() === '') {
      errors.buildingId = 'Choose the building this complaint is about.'
    }
    if (raw.roomChoice === undefined || raw.roomChoice === null || String(raw.roomChoice).trim() === '') {
      errors.roomChoice = 'Say whether the room is known.'
    }
  }
  const data = normaliseGeneric(spec, raw, errors)
  const collegeId = spec.scope === 'campus' ? ctx.collegeId : null

  // Identity
  const suppliedId = raw.id ? String(raw.id).trim() : ''
  if (suppliedId && !/^[A-Za-z0-9_.:-]{2,80}$/.test(suppliedId)) {
    fail(errors, 'id', 'ID may contain letters, numbers, dot, colon, underscore or hyphen (2-80 characters).')
  }
  const id = suppliedId || `${PREFIX[entity] ?? 'rec'}-${randomUUID().slice(0, 12)}`
  if (ctx.db.getRecord(id)) fail(errors, 'id', `ID "${id}" already exists.`)
  data.id = id
  if (collegeId) data.collegeId = collegeId

  // Entity-specific defaults and cross-field rules
  if (entity === 'buildings') {
    if (!data.address) data.address = null
    if (!data.notes) data.notes = null
  }

  if (entity === 'rooms') {
    const building = recordInCollege(ctx.db, String(data.buildingId), 'buildings', collegeId)
    if (!building && !options.inBatchIds?.has(`buildings:${data.buildingId}`)) {
      fail(errors, 'buildingId', 'That building does not exist in this college.')
    }
    data.name = data.name ?? null
    data.floor = data.floor ?? null
    data.notes = data.notes ?? null
  }

  if (entity === 'timetableSlots') {
    const room = recordInCollege(ctx.db, String(data.roomId), 'rooms', collegeId)
    if (!room && !options.inBatchIds?.has(`rooms:${data.roomId}`)) {
      fail(errors, 'roomId', 'That room does not exist in this college.')
    }
    if (data.startsAt && data.endsAt && Date.parse(String(data.endsAt)) <= Date.parse(String(data.startsAt))) {
      fail(errors, 'endsAt', 'End time must be after the start time.')
    }
    data.moduleCode = data.moduleCode ?? null
  }

  if (entity === 'assets') {
    if (data.buildingId) {
      const building = recordInCollege(ctx.db, String(data.buildingId), 'buildings', collegeId)
      if (!building && !options.inBatchIds?.has(`buildings:${data.buildingId}`)) {
        fail(errors, 'buildingId', 'That building does not exist in this college.')
      }
    }
    data.installedAt = data.installedAt ?? null
    data.condition = data.condition ?? null
    data.lastInspectedAt = data.lastInspectedAt ?? null
    data.inspectionIntervalDays = data.inspectionIntervalDays ?? null
    data.criticality = data.criticality ?? null
    data.notes = data.notes ?? null
  }

  if (entity === 'inspections') {
    const asset = recordInCollege(ctx.db, String(data.assetId), 'assets', collegeId)
    if (!asset && !options.inBatchIds?.has(`assets:${data.assetId}`)) {
      fail(errors, 'assetId', 'That asset does not exist in this college.')
    }
    const inspectorId = data.inspectorUserId ? String(data.inspectorUserId) : null
    if (inspectorId && !isCollegeMember(ctx.db, inspectorId, collegeId, ['maintenance', 'estates', 'admin'])) {
      fail(errors, 'inspectorUserId', 'Choose a staff member of this college.')
    }
    data.inspectorUserId = inspectorId
    data.completedAt = data.completedAt ?? null
    data.findings = data.findings ?? null
    // Completion time is only accepted when supplied. A completed inspection
    // with no recorded time keeps that gap rather than inventing a timestamp.
  }

  if (entity === 'utilityMeters') {
    const building = recordInCollege(ctx.db, String(data.buildingId), 'buildings', collegeId)
    if (!building && !options.inBatchIds?.has(`buildings:${data.buildingId}`)) {
      fail(errors, 'buildingId', 'That building does not exist in this college.')
    }
    if (data.utility === 'electricity' && data.unit !== 'kWh') {
      fail(errors, 'unit', 'Electricity meters should use kWh.')
    }
    if (data.utility === 'water' && data.unit !== 'm3') {
      fail(errors, 'unit', 'Water meters should use m3.')
    }
    data.measurementType = data.measurementType === 'estimated' ? 'estimated' : 'measured'
  }

  if (entity === 'utilityReadings') {
    const meter = recordInCollege(ctx.db, String(data.meterId), 'utilityMeters', collegeId)
    if (!meter && !options.inBatchIds?.has(`utilityMeters:${data.meterId}`)) {
      fail(errors, 'meterId', 'That meter does not exist in this college.')
    } else if (meter && data.unit !== meter.data.unit) {
      fail(errors, 'unit', `This meter records in ${String(meter.data.unit)}.`)
    }
    data.note = data.note ?? null
    // Duplicate meter + read date would double-count a period.
    const duplicate = dbReadingsForMeter(ctx.db, String(data.meterId), collegeId).some(
      (r) => r.id !== id && String(r.data.readAt) === String(data.readAt),
    )
    if (duplicate) fail(errors, 'readAt', 'A reading already exists for this meter and date.')
  }

  if (entity === 'tariffs') {
    data.standingChargePerPeriod = data.standingChargePerPeriod ?? null
    data.note = data.note ?? null
  }

  if (entity === 'complaints') {
    data.reporterId = ctx.actor.id
    data.raisedAt = ctx.mode === 'import' && data.raisedAt ? data.raisedAt : at
    data.status = ctx.mode === 'import' && data.status ? data.status : 'open'
    data.resolvedAt = data.resolvedAt ?? null
    validateComplaintTargets(ctx.db, data, collegeId, errors, options.inBatchIds, { requireBuilding: true })
    const descriptionError = complaintDescriptionError(data.description)
    if (descriptionError) fail(errors, 'description', descriptionError)
    const assignee = data.assignedToUserId ? String(data.assignedToUserId) : null
    if (assignee && !isCollegeMember(ctx.db, assignee, collegeId, ['maintenance', 'estates'])) {
      fail(errors, 'assignedToUserId', 'Choose a maintenance or estates member of this college.')
    }
    data.assignedToUserId = assignee
    const photo = validPhoto(raw as Record<string, unknown>, errors)
    data.photoName = photo.name
    data.photoDataUrl = photo.dataUrl
  }

  if (entity === 'planOptions') {
    for (const key of ['capitalCost', 'annualCost', 'annualSavings', 'capacityGainSeats', 'demandReducedSeats', 'disruptionDays', 'implementationWeeks']) {
      data[key] = data[key] ?? null
    }
  }

  if (entity === 'nearbyAssets' && data.dailyUsers === null) data.usersMethod = null
  if (entity === 'nearbyAssets' && data.dailyUsers !== null && !data.usersMethod) {
    fail(errors, 'usersMethod', 'Explain how daily users were obtained when a number is entered.')
  }

  if (entity === 'urbanAssets') {
    data.name = data.name ?? null
    data.locationLabel = data.locationLabel ?? null
    data.ownerAuthority = data.ownerAuthority ?? null
  }

  if (entity === 'urbanIssues') {
    data.reporterCollegeId = ctx.collegeId
    data.reporterId = ctx.actor.id
    data.reportedAt = ctx.mode === 'import' && data.reportedAt ? data.reportedAt : at
    data.status = ctx.mode === 'import' && data.status ? data.status : 'reported'
    data.resolvedAt = data.resolvedAt ?? null
    if (data.urbanAssetId) {
      const asset = recordInCollege(ctx.db, String(data.urbanAssetId), 'urbanAssets', null)
      if (!asset && !options.inBatchIds?.has(`urbanAssets:${data.urbanAssetId}`)) {
        fail(errors, 'urbanAssetId', 'That public asset does not exist.')
      }
    }
    data.authority = data.authority ?? null
    data.note = data.note ?? null
    const photo = validPhoto(raw, errors)
    data.photoName = photo.name
    data.photoDataUrl = photo.dataUrl
  }

  if (!data.raisedAt && entity === 'complaints') data.raisedAt = at
  if (entity === 'urbanIssues' && !data.locationLabel) fail(errors, 'locationLabel', 'Location is required.')

  if (Object.keys(errors).length > 0) {
    return { ok: false, error: 'Some fields need attention.', fieldErrors: errors }
  }

  if (duplicateKey(ctx.db, entity, collegeId, data)) {
    return {
      ok: false,
      error: 'A matching record already exists (duplicate natural key).',
      fieldErrors: {},
    }
  }

  return { ok: true, record: data, meta: {} }
}

export function updateEntityRecord(
  existing: StoredRecord,
  patch: Record<string, unknown>,
  ctx: ValidationContext,
): ValidationResult {
  const entity = existing.entity
  const spec = ENTITY_BY_NAME.get(entity)
  if (!spec) return { ok: false, error: 'Unknown record type.', fieldErrors: {} }
  if (!canUpdate(existing, ctx)) return { ok: false, error: 'Your role cannot update this record.', fieldErrors: {} }

  const errors: Record<string, string> = {}
  const data: Record<string, unknown> = { ...existing.data }

  if (entity === 'complaints') {
    if (ctx.actor.role === 'maintenance') {
      const allowed = new Set(['status', 'note'])
      const extra = Object.keys(patch).filter((k) => !allowed.has(k))
      if (extra.length > 0) {
        return { ok: false, error: 'Maintenance staff can update the status of an assigned complaint only.', fieldErrors: {} }
      }
    }
    if (patch.status !== undefined && patch.status !== existing.data.status) {
      const from = String(existing.data.status) as ComplaintStatus
      const to = String(patch.status) as ComplaintStatus
      const allowed: Record<ComplaintStatus, ComplaintStatus[]> = {
        open: ['in_progress', 'resolved', 'closed'],
        in_progress: ['resolved', 'open', 'closed'],
        resolved: ['closed', 'in_progress'],
        closed: ['open'],
      }
      if (!allowed[from]?.includes(to)) {
        return { ok: false, error: `Status cannot move from ${from} to ${to}.`, fieldErrors: { status: 'Invalid status transition.' } }
      }
      if (ctx.actor.role === 'maintenance') {
        // The job machine is strict: To do -> In progress -> Done. Skipping a
        // step or moving backwards is refused even on this generic endpoint.
        const strict: Partial<Record<ComplaintStatus, ComplaintStatus[]>> = {
          open: ['in_progress'],
          in_progress: ['resolved'],
        }
        if (!strict[from]?.includes(to)) {
          return {
            ok: false,
            error: 'Maintenance staff move a job from To do to In progress, and from In progress to done.',
            fieldErrors: { status: 'Use Start, then Mark done.' },
          }
        }
        if (to === 'resolved' && !(typeof patch.note === 'string' && patch.note.trim().length >= 10)) {
          return {
            ok: false,
            error: 'Write what you did, at least 10 characters, before marking a job done.',
            fieldErrors: { note: 'Write what you did, at least 10 characters.' },
          }
        }
      }
      const note = typeof patch.note === 'string' ? patch.note.trim() : ''
      if (to === 'closed' && from === 'resolved') {
        // The job was already fixed; closing now only files the ticket. The
        // repair outcome stays Fixed and the resolution time is retained.
        data.status = to
        data.closedAt = new Date().toISOString()
        data.closedReason = null
      } else if (to === 'closed') {
        // Closing without a repair is a distinct outcome from Fixed, so it
        // must carry the reason estates is giving the reporter.
        if (note.length < 10) {
          return {
            ok: false,
            error: 'Say why this report is being closed without a repair, at least 10 characters.',
            fieldErrors: { note: 'Say why this report is being closed without a repair, at least 10 characters.' },
          }
        }
        data.status = to
        data.resolvedAt = null
        data.closedAt = new Date().toISOString()
        data.closedReason = note
      } else {
        if (
          to === 'resolved' &&
          ctx.actor.role !== 'maintenance' &&
          note.length < 10
        ) {
          return {
            ok: false,
            error: 'Write what was done, at least 10 characters, before marking this report Fixed.',
            fieldErrors: { note: 'Write what was done, at least 10 characters.' },
          }
        }
        data.status = to
        data.resolvedAt = to === 'resolved' ? new Date().toISOString() : null
        data.closedAt = null
        data.closedReason = null
        if (to === 'resolved' && note) data.completionNote = note
      }
    }
    if (patch.assignedToUserId !== undefined) {
      if (ctx.actor.role === 'maintenance') {
        return { ok: false, error: 'Only estates or administrators can assign complaints.', fieldErrors: {} }
      }
      const assignee = patch.assignedToUserId ? String(patch.assignedToUserId) : null
      if (assignee && !isCollegeMember(ctx.db, assignee, existing.collegeId!, ['maintenance', 'estates'])) {
        return { ok: false, error: 'Choose a maintenance or estates member of this college.', fieldErrors: { assignedToUserId: 'Invalid assignee.' } }
      }
      data.assignedToUserId = assignee
    }
    for (const key of ['category', 'severity', 'description', 'peopleAffected']) {
      if (patch[key] !== undefined) data[key] = patch[key]
    }
    const targetKeys = ['buildingId', 'roomChoice', 'roomId', 'assetId']
    const targetChanged = targetKeys.some((key) => patch[key] !== undefined)
    if (targetChanged) {
      if (patch.buildingId !== undefined) data.buildingId = patch.buildingId ? String(patch.buildingId).trim() : null
      if (patch.roomId !== undefined) data.roomId = patch.roomId ? String(patch.roomId).trim() : null
      if (patch.assetId !== undefined) data.assetId = patch.assetId ? String(patch.assetId).trim() : null
      if (patch.roomChoice !== undefined) {
        const choice = String(patch.roomChoice ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
        if (choice === 'room' || choice === 'not_sure') data.roomChoice = choice
        else errors.roomChoice = 'Say whether the room is known.'
      }
    }
    if (data.category !== undefined && !String(data.category).trim()) errors.category = 'Category is required.'
    if (!SEVERITY.includes(String(data.severity))) errors.severity = 'Severity is invalid.'
    if (!String(data.description ?? '').trim()) errors.description = 'Description is required.'
    else if (patch.description !== undefined) {
      const descriptionError = complaintDescriptionError(data.description)
      if (descriptionError) fail(errors, 'description', descriptionError)
    }
    const people = data.peopleAffected
    if (people !== null && people !== undefined) {
      const n = Number(people)
      if (!Number.isInteger(n) || n < 0) errors.peopleAffected = 'People affected must be a whole number, or empty.'
    }
    if (targetChanged) {
      validateComplaintTargets(ctx.db, data, existing.collegeId, errors, undefined, { requireBuilding: true })
    }
  } else if (entity === 'inspections') {
    if (ctx.actor.role === 'maintenance') {
      const allowed = new Set(['status', 'findings', 'completedAt'])
      const extra = Object.keys(patch).filter((k) => !allowed.has(k))
      if (extra.length > 0) {
        return { ok: false, error: 'You can update only the outcome of your assigned inspection.', fieldErrors: {} }
      }
    }
    for (const key of ['status', 'findings', 'completedAt', 'scheduledFor', 'inspectorUserId']) {
      if (patch[key] !== undefined) data[key] = patch[key]
    }
    if (!['scheduled', 'completed', 'cancelled'].includes(String(data.status))) errors.status = 'Invalid inspection status.'
    if (data.scheduledFor !== undefined && data.scheduledFor !== null) {
      const time = Date.parse(String(data.scheduledFor))
      if (Number.isNaN(time)) errors.scheduledFor = 'Scheduled date must be an ISO 8601 date.'
      else data.scheduledFor = new Date(time).toISOString()
    }
    if (data.completedAt !== undefined && data.completedAt !== null && String(data.completedAt) !== '') {
      const time = Date.parse(String(data.completedAt))
      if (Number.isNaN(time)) errors.completedAt = 'Completion date must be an ISO 8601 date.'
      else data.completedAt = new Date(time).toISOString()
    } else {
      data.completedAt = null
    }
    if (data.status === 'completed' && !data.completedAt) {
      // Keep the gap, but tell the caller to ask for the completion time.
      errors.completedAt = 'Record when this inspection was completed.'
    }
    if (data.status !== 'completed') data.completedAt = data.completedAt ?? null
    if (data.inspectorUserId) {
      const inspector = String(data.inspectorUserId)
      if (!isCollegeMember(ctx.db, inspector, existing.collegeId, ['maintenance', 'estates', 'admin'])) {
        errors.inspectorUserId = 'Choose a staff member of this college.'
      }
    } else {
      data.inspectorUserId = null
    }
  } else if (entity === 'urbanIssues') {
    if (ctx.actor.role !== 'admin' && ctx.actor.role !== 'estates' && ctx.actor.role !== 'maintenance') {
      return { ok: false, error: 'Your role cannot update public infrastructure issues.', fieldErrors: {} }
    }
    const allowed = new Set(['status', 'note'])
    const extra = Object.keys(patch).filter((key) => !allowed.has(key))
    if (extra.length > 0) {
      return {
        ok: false,
        error: 'Only the status and a resolution note can be updated on a public issue.',
        fieldErrors: {},
      }
    }
    if (patch.status !== undefined) {
      const statuses = ['reported', 'in_progress', 'resolved', 'closed']
      if (!statuses.includes(String(patch.status))) errors.status = 'Invalid public issue status.'
      else {
        data.status = patch.status
        data.resolvedAt = patch.status === 'resolved' || patch.status === 'closed' ? new Date().toISOString() : null
      }
    }
    if (patch.note !== undefined) {
      const note = patch.note === null ? null : String(patch.note).trim()
      if (note && note.length > 4000) errors.note = 'Note is too long.'
      else data.note = note || null
    }
  } else {
    // For all other entities merge only known fields, then re-validate fully.
    for (const field of spec.fields) {
      if (patch[field.key] !== undefined) data[field.key] = patch[field.key]
    }
    if (entity === 'buildings' || entity === 'rooms' || entity === 'assets' || entity === 'utilityMeters' || entity === 'utilityReadings' || entity === 'tariffs' || entity === 'planOptions' || entity === 'urbanAssets' || entity === 'nearbyAssets') {
      // Re-run the same field normalisers so partial edits cannot inject bad types.
      const normalised = normaliseGeneric(spec, data, errors)
      Object.assign(data, normalised)
    }
  }

  if (entity === 'nearbyAssets') {
    data.id = existing.id
    data.collegeId = existing.collegeId
    if (data.dailyUsers === null) data.usersMethod = null
  }
  if (entity === 'nearbyAssets' && data.dailyUsers !== null && !data.usersMethod) {
    errors.usersMethod = 'Explain how daily users were obtained when a number is entered.'
  }

  if (Object.keys(errors).length === 0) {
    // Cross-field checks reused from create validation where they are cheap.
    if (entity === 'rooms' && data.buildingId && !recordInCollege(ctx.db, String(data.buildingId), 'buildings', existing.collegeId)) {
      errors.buildingId = 'That building does not exist in this college.'
    }
    if (entity === 'timetableSlots' && data.startsAt && data.endsAt && Date.parse(String(data.endsAt)) <= Date.parse(String(data.startsAt))) {
      errors.endsAt = 'End time must be after the start time.'
    }
    if (entity === 'utilityMeters') {
      if (data.utility === 'electricity' && data.unit !== 'kWh') errors.unit = 'Electricity meters should use kWh.'
      if (data.utility === 'water' && data.unit !== 'm3') errors.unit = 'Water meters should use m3.'
    }
    if (entity === 'utilityReadings') {
      const meter = recordInCollege(ctx.db, String(data.meterId), 'utilityMeters', existing.collegeId)
      if (meter && data.unit !== meter.data.unit) errors.unit = `This meter records in ${String(meter.data.unit)}.`
    }
    if (entity === 'assets' && data.buildingId && !recordInCollege(ctx.db, String(data.buildingId), 'buildings', existing.collegeId)) {
      errors.buildingId = 'That building does not exist in this college.'
    }
    if (entity === 'complaints') {
      data.id = existing.id
      data.collegeId = existing.collegeId
      data.reporterId = existing.data.reporterId
      data.raisedAt = existing.data.raisedAt
      data.photoName = existing.data.photoName ?? null
      data.photoDataUrl = existing.data.photoDataUrl ?? null
    }
    if (entity === 'inspections' && !recordInCollege(ctx.db, String(data.assetId), 'assets', existing.collegeId)) {
      errors.assetId = 'That asset does not exist in this college.'
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, error: 'Some fields need attention.', fieldErrors: errors }

  const duplicate = duplicateKey(ctx.db, entity, existing.collegeId, data, existing.id)
  if (duplicate) return { ok: false, error: 'A matching record already exists (duplicate natural key).', fieldErrors: {} }

  const meta: RecordMeta = {}
  if (entity === 'complaints') {
    const from = existing.data.status as ComplaintStatus
    const to = data.status as ComplaintStatus
    if (from !== to) meta.statusChange = { from, to }
    const oldAssignee = (existing.data.assignedToUserId ?? null) as string | null
    const newAssignee = (data.assignedToUserId ?? null) as string | null
    if (oldAssignee !== newAssignee) meta.assignedChange = { from: oldAssignee, to: newAssignee }
    const oldCategory = String(existing.data.category)
    if (oldCategory !== String(data.category)) meta.categoryChange = { from: oldCategory, to: String(data.category) }
    if (typeof patch.note === 'string') meta.note = patch.note
  }
  return { ok: true, record: data, meta }
}

function isCollegeMember(db: Database, userId: string, collegeId: string | null, roles: string[]): boolean {
  if (!collegeId) return false
  const role = db.membershipRole(userId, collegeId)
  return role !== null && roles.includes(role)
}

function dbReadingsForMeter(db: Database, meterId: string, collegeId: string | null): StoredRecord[] {
  return db.listRecords('utilityReadings', collegeId).filter((r) => String(r.data.meterId) === meterId)
}

export { SEVERITY }
