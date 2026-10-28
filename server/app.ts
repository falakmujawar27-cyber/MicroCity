/**
 * MicroCity HTTP API.
 *
 * Authentication, college isolation and authorisation are enforced here, on
 * the server. The browser never receives records from a college the signed-in
 * account does not belong to, and all record writes pass through the
 * server-authoritative validators in record-validation.ts.
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CAMPUS_ENTITIES, ENTITY_BY_NAME, IMPORT_ORDER } from '../src/domain/entities.ts'
import { ALL_ROLES, hasCapability } from '../src/domain/permissions.ts'
import type {
  Asset,
  AttendanceReason,
  AttendanceRecord,
  Building,
  Complaint,
  ComplaintStatus,
  DatasetProvenance,
  DatasetSources,
  Decision,
  ImportEntityOutcome,
  ImportLogEntry,
  ImportOutcome,
  ImportRowOutcome,
  ImportSheetInput,
  Inspection,
  InspectionResult,
  Room,
  SessionInfo,
  TimetableSlot,
  UrbanIssue,
  UserRole,
  WorkspacePayload,
} from '../src/domain/types.ts'
import { ATTENDANCE_REASONS, INSPECTION_RESULTS } from '../src/domain/types.ts'
import { istDateKey } from '../src/lib/time.ts'
import { loadAiSettings, runAiTask, type AiTask } from './ai.ts'
import type { Database, StoredRecord, StoredUser } from './db.ts'
import { hashPassword, verifyPassword } from './passwords.ts'
import { SAMPLE_ACCOUNTS } from './seed.ts'
import {
  buildInspectionCards,
  buildJobCards,
  inspectionsDue,
  type InspectionCard,
  type JobCard,
} from './jobs.ts'
import {
  canCreate,
  canDelete,
  canUpdate,
  createEntityRecord,
  deletionGuard,
  updateEntityRecord,
  validPhoto,
  type Actor,
  type ValidationContext,
} from './record-validation.ts'

const SESSION_COOKIE = 'mc_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const LOGIN_WINDOW_MS = 5 * 60 * 1000
const LOGIN_LIMIT = 8
const DUMMY_SALT = 'microcity-timing-salt'
const DUMMY_HASH = hashPassword('not-a-real-password', DUMMY_SALT)

class HttpError extends Error {
  status: number
  details: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.details = details
  }
}

interface SessionRecord {
  token: string
  user: StoredUser
  memberships: { collegeId: string; collegeName: string; role: string }[]
}

interface ActiveCollege {
  collegeId: string
  collegeName: string
  role: UserRole
}

interface LoginAttempt {
  count: number
  resetAt: number
}

interface PreparedRow {
  rowNumber: number
  raw: Record<string, unknown>
  warnings: string[]
}

interface RefIndex {
  ids: Map<string, string>
  labels: Map<string, Set<string>>
}

interface ImportRequest {
  fileName: string
  mode: 'append' | 'replace'
  sheets: ImportSheetInput[]
  confirmReplace: boolean
}

export interface MicrocityApp {
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
  db: Database
  aiConfigured: boolean
}

export function createMicrocityApp(options: {
  db: Database
  env?: NodeJS.ProcessEnv
}): MicrocityApp {
  const db = options.db
  const env = options.env ?? process.env
  const secureCookie = env.COOKIE_SECURE === 'true'
  const aiSettings = loadAiSettings(env)
  const loginAttempts = new Map<string, LoginAttempt>()
  const registerAttempts = new Map<string, LoginAttempt>()
  const aiUsage = new Map<string, LoginAttempt>()

  /* -------------------------------------------------------------- */
  /* Small HTTP helpers                                             */
  /* -------------------------------------------------------------- */

  function sendJson(res: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Content-Length': Buffer.byteLength(body),
    })
    res.end(body)
  }

  async function readJson(req: IncomingMessage, limit = 8_000_000): Promise<Record<string, unknown>> {
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
    if (!contentType.startsWith('application/json')) {
      throw new HttpError(415, 'Send this request as application/json.')
    }
    const declared = Number(req.headers['content-length'] ?? 0)
    if (Number.isFinite(declared) && declared > limit) {
      throw new HttpError(413, 'This request is too large.')
    }
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
      total += buffer.length
      if (total > limit) throw new HttpError(413, 'This request is too large.')
      chunks.push(buffer)
    }
    if (total === 0) return {}
    let parsed: unknown
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch {
      throw new HttpError(400, 'The request body is not valid JSON.')
    }
    if (!isRecord(parsed)) throw new HttpError(400, 'The request body must be a JSON object.')
    return parsed
  }

  function setSessionCookie(res: ServerResponse, token: string): void {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
        SESSION_TTL_MS / 1000,
      )}${secureCookie ? '; Secure' : ''}`,
    )
  }

  function clearSessionCookie(res: ServerResponse): void {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureCookie ? '; Secure' : ''}`,
    )
  }

  function getSession(req: IncomingMessage): SessionRecord | null {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
    if (!token) return null
    const user = db.getSessionUser(token)
    if (!user) return null
    return { token, user, memberships: db.getMemberships(user.id) }
  }

  function requireSession(req: IncomingMessage): SessionRecord {
    const session = getSession(req)
    if (!session) throw new HttpError(401, 'Sign in to continue.', { code: 'unauthenticated' })
    return session
  }

  function requireActive(
    req: IncomingMessage,
    url: URL,
    session: SessionRecord,
    explicitCollegeId?: string,
  ): ActiveCollege {
    const header = req.headers['x-college-id']
    const requested =
      explicitCollegeId ??
      (typeof header === 'string' ? header : null) ??
      url.searchParams.get('collegeId') ??
      (session.memberships.length === 1 ? session.memberships[0].collegeId : null)
    if (!requested) {
      throw new HttpError(400, 'Choose a college to work in.', { code: 'college-required' })
    }
    const membership = session.memberships.find((item) => item.collegeId === requested)
    if (!membership) {
      throw new HttpError(403, 'Your account is not a member of that college.', { code: 'college-forbidden' })
    }
    const role = asRole(membership.role)
    if (!role) {
      throw new HttpError(403, 'Your membership has an unrecognised role. Ask an administrator to correct it.')
    }
    return { collegeId: membership.collegeId, collegeName: membership.collegeName, role }
  }

  function actorFrom(session: SessionRecord, active: ActiveCollege): Actor {
    return { id: session.user.id, displayName: session.user.displayName, role: active.role }
  }

  function validationContext(actor: Actor, collegeId: string, mode: 'ui' | 'import'): ValidationContext {
    return { db, actor, collegeId, mode }
  }

  function clientAddress(req: IncomingMessage): string {
    return req.socket.remoteAddress ?? 'unknown'
  }

  function bumpLimit(
    map: Map<string, LoginAttempt>,
    key: string,
    limit: number,
    windowMs: number,
    message: string,
  ): void {
    const now = Date.now()
    if (map.size > 4000) {
      for (const [entryKey, entry] of map) {
        if (entry.resetAt <= now) map.delete(entryKey)
      }
    }
    const existing = map.get(key)
    if (!existing || existing.resetAt <= now) {
      map.set(key, { count: 1, resetAt: now + windowMs })
      return
    }
    if (existing.count >= limit) {
      const wait = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
      throw new HttpError(429, `${message} Try again in ${wait} seconds.`, { retryAfterSeconds: wait })
    }
    existing.count += 1
  }

  /* -------------------------------------------------------------- */
  /* Workspace shaping                                              */
  /* -------------------------------------------------------------- */

  function buildWorkspace(session: SessionRecord, active: ActiveCollege): WorkspacePayload {
    const role = active.role
    const full = role === 'admin' || role === 'estates'
    const viewResources = hasCapability(role, 'view-resources')
    const viewPlan = hasCapability(role, 'view-plan')
    const viewAudit = hasCapability(role, 'view-audit')
    // The maintenance role works through assigned jobs and inspections only.
    // Public infrastructure is handled by estates and administrators.
    const canSeePublic = role !== 'maintenance'
    const nameCache = new Map<string, string | null>()

    const nameOf = (id: string | null | undefined): string | null => {
      if (!id) return null
      if (!nameCache.has(id)) nameCache.set(id, db.getUser(id)?.displayName ?? null)
      return nameCache.get(id) ?? null
    }

    const campus = (entity: string): StoredRecord[] => db.listRecords(entity, active.collegeId)
    const publicRecords = (entity: string): StoredRecord[] => db.listRecords(entity, null)
    const dataOf = <T,>(records: StoredRecord[]): T[] =>
      records.map((record) => ({ ...record.data }) as unknown as T)

    const allComplaints = campus('complaints')
    const complaints: Complaint[] =
      role === 'admin' || role === 'estates'
        ? dataOf<Complaint>(allComplaints)
        : role === 'maintenance'
          ? dataOf<Complaint>(
              allComplaints.filter(
                (record) => String(record.data.assignedToUserId ?? '') === session.user.id,
              ),
            )
          : dataOf<Complaint>(
              allComplaints.filter((record) => String(record.data.reporterId ?? '') === session.user.id),
            )

    const visibleComplaintIds = new Set(complaints.map((item) => item.id))
    const enrichedComplaints = complaints.map((item) => ({
      ...item,
      reporterName: nameOf(item.reporterId) ?? 'Unknown reporter',
      assignedToName: nameOf(item.assignedToUserId),
    }))

    const visibleUpdates = campus('complaintUpdates').filter((record) =>
      visibleComplaintIds.has(String(record.data.complaintId ?? '')),
    )

    const inspections =
      role === 'maintenance'
        ? campus('inspections').filter(
            (record) => String(record.data.inspectorUserId ?? '') === session.user.id,
          )
        : role === 'faculty' || role === 'student'
          ? []
          : campus('inspections')

    const decisions = viewPlan
      ? dataOf<Decision>(campus('decisions')).map((item) => ({
          ...item,
          decidedByName: nameOf(item.decidedByUserId),
          ownerName: nameOf(item.ownerUserId),
        }))
      : []

    const urbanIssues = canSeePublic
      ? dataOf<UrbanIssue>(publicRecords('urbanIssues')).map((item) => ({
          ...item,
          reporterName: nameOf(item.reporterId) ?? 'Unknown reporter',
        }))
      : []

    const canViewTimetable = full || role === 'faculty'
    const canViewAttendance = full || role === 'faculty'
    const attendanceRecords = canViewAttendance
      ? dataOf<AttendanceRecord>(campus('attendanceRecords'))
      : []
    const attendanceBySlot = new Map(attendanceRecords.map((record) => [record.slotId, record]))
    // Saved attendance overlays the timetable booking so capacity analysis
    // reflects the latest logged headcount without duplicating the record.
    const timetableSlots = canViewTimetable
      ? dataOf<TimetableSlot>(campus('timetableSlots')).map((slot) => {
          const record = attendanceBySlot.get(slot.id)
          return record ? { ...slot, attendance: record.present } : slot
        })
      : []

    const sources = {
      buildings: dataOf(campus('buildings')),
      rooms: dataOf(campus('rooms')),
      timetableSlots,
      attendanceRecords,
      assets: full || role === 'maintenance' ? dataOf(campus('assets')) : [],
      inspections: dataOf(inspections),
      utilityMeters: viewResources ? dataOf(campus('utilityMeters')) : [],
      utilityReadings: viewResources ? dataOf(campus('utilityReadings')) : [],
      tariffs: viewResources ? dataOf(campus('tariffs')) : [],
      complaints: enrichedComplaints,
      complaintUpdates: dataOf(visibleUpdates),
      planOptions: viewPlan ? dataOf(campus('planOptions')) : [],
      decisions,
      urbanAssets: canSeePublic ? dataOf(publicRecords('urbanAssets')) : [],
      urbanIssues,
    } as unknown as DatasetSources

    const imports = full
      ? db.listImportLogs(active.collegeId).map(
          (row): ImportLogEntry => ({
            id: row.id,
            collegeId: row.collegeId,
            actorName: row.actorName,
            fileName: row.fileName,
            kind: row.kind,
            mode: row.mode,
            totalImported: row.totalImported,
            summary: row.summary,
            at: row.at,
          }),
        )
      : []

    const audit = viewAudit
      ? db.listAudit(active.collegeId, 120).map((row) => ({
          id: row.id,
          at: row.at,
          actorName: row.actorName,
          action: row.action,
          entity: row.entity,
          entityId: row.entityId,
          detail: row.detail,
        }))
      : []

    const members = full
      ? db.listCollegeMembers(active.collegeId).map((member) => ({
          id: member.id,
          displayName: member.displayName,
          role: member.role as UserRole,
          sample: member.sample,
        }))
      : []

    return {
      activeCollege: { id: active.collegeId, name: active.collegeName, role },
      memberships: session.memberships.map((membership) => ({
        collegeId: membership.collegeId,
        collegeName: membership.collegeName,
        role: membership.role as UserRole,
      })),
      provenance: readProvenance(db),
      dataset: sources,
      imports,
      audit,
      members,
      serverTime: new Date().toISOString(),
    }
  }

  /* -------------------------------------------------------------- */
  /* Audit helpers                                                  */
  /* -------------------------------------------------------------- */

  function writeAudit(
    active: ActiveCollege,
    actor: Actor,
    action: string,
    entity: string,
    entityId: string | null,
    detail: string,
    metadata?: unknown,
  ): void {
    db.addAudit({
      collegeId: active.collegeId,
      actorId: actor.id,
      actorName: actor.displayName,
      action,
      entity,
      entityId,
      detail,
      metadata: metadata ? JSON.stringify(metadata) : null,
    })
  }

  function addComplaintEvent(
    active: ActiveCollege,
    actor: Actor,
    complaintId: string,
    kind: 'created' | 'assigned' | 'status' | 'note' | 'category',
    note: string,
    fromStatus: ComplaintStatus | null,
    toStatus: ComplaintStatus | null,
  ): void {
    const id = `cupd-${randomUUID()}`
    db.insertRecord({
      id,
      entity: 'complaintUpdates',
      collegeId: active.collegeId,
      data: {
        id,
        collegeId: active.collegeId,
        complaintId,
        at: new Date().toISOString(),
        actorId: actor.id,
        actorName: actor.displayName,
        kind,
        note,
        fromStatus,
        toStatus,
      },
      source: 'ui',
    })
  }

  function nextTicketNumber(collegeId: string): string {
    let highest = 0
    for (const record of db.listRecords('complaints', collegeId)) {
      const match = String(record.data.ticketNumber ?? '').match(/^MC-(\d+)$/)
      if (match) highest = Math.max(highest, Number(match[1]))
    }
    return `MC-${String(highest + 1).padStart(4, '0')}`
  }

  /* -------------------------------------------------------------- */
  /* Record handlers                                                */
  /* -------------------------------------------------------------- */

  function getRecordForActive(active: ActiveCollege, entity: string, id: string): StoredRecord {
    const record = db.getRecord(id)
    if (!record || record.entity !== entity) throw new HttpError(404, 'Record not found.')
    const spec = ENTITY_BY_NAME.get(entity)
    if (!spec) throw new HttpError(404, 'Unknown record type.')
    if (spec.scope === 'campus' && record.collegeId !== active.collegeId) {
      throw new HttpError(404, 'Record not found.')
    }
    if (spec.scope === 'public' && record.collegeId !== null) {
      throw new HttpError(404, 'Record not found.')
    }
    return record
  }

  async function handleRecordCreate(
    req: IncomingMessage,
    res: ServerResponse,
    entity: string,
  ): Promise<void> {
    const spec = ENTITY_BY_NAME.get(entity)
    if (!spec) throw new HttpError(404, 'Unknown record type.')
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    const actor = actorFrom(session, active)
    const body = await readJson(req, 8_000_000)
    if (!isRecord(body.data)) throw new HttpError(400, 'Send the record fields in "data".')
    const ctx = validationContext(actor, active.collegeId, 'ui')
    if (!canCreate(entity, ctx)) {
      throw new HttpError(403, 'Your role cannot create this kind of record.')
    }
    const result = createEntityRecord(entity, body.data, ctx)
    if (!result.ok) {
      throw new HttpError(422, result.error, { fieldErrors: result.fieldErrors })
    }
    const data = result.record
    const id = String(data.id)
    const recordCollegeId = spec.scope === 'campus' ? active.collegeId : null
    const ownerId =
      entity === 'complaints' || entity === 'urbanIssues' ? String(data.reporterId ?? actor.id) : null
    const insertRecord = () =>
      db.insertRecord({
        id,
        entity,
        collegeId: recordCollegeId,
        ownerId,
        data,
        source: 'ui',
      })
    if (entity === 'complaints') {
      // The ticket number is derived from the highest existing number in the
      // same college, so reading and inserting happen in one write
      // transaction; the unique index is the database-level backstop.
      db.sql.exec('BEGIN IMMEDIATE')
      try {
        data.ticketNumber = nextTicketNumber(active.collegeId)
        insertRecord()
        db.sql.exec('COMMIT')
      } catch (error) {
        db.sql.exec('ROLLBACK')
        throw error
      }
    } else {
      insertRecord()
    }
    writeAudit(active, actor, 'create', entity, id, `Created ${describeRecord(entity, data)}.`)
    if (entity === 'complaints') {
      addComplaintEvent(active, actor, id, 'created', 'Complaint submitted.', null, 'open')
    }
    sendJson(res, 201, { record: data })
  }

  async function handleRecordUpdate(
    req: IncomingMessage,
    res: ServerResponse,
    entity: string,
    id: string,
  ): Promise<void> {
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    const actor = actorFrom(session, active)
    const existing = getRecordForActive(active, entity, id)
    const ctx = validationContext(actor, active.collegeId, 'ui')
    if (!canUpdate(existing, ctx)) {
      throw new HttpError(403, 'Your role cannot update this record.')
    }
    const body = await readJson(req, 8_000_000)
    if (!isRecord(body.data)) throw new HttpError(400, 'Send the changed fields in "data".')
    const result = updateEntityRecord(existing, body.data, ctx)
    if (!result.ok) {
      throw new HttpError(422, result.error, { fieldErrors: result.fieldErrors })
    }
    db.updateRecord(existing.id, result.record)

    if (entity === 'complaints') {
      const meta = result.meta
      let usedNote = false
      if (meta.statusChange) {
        const note = meta.note?.trim()
          ? meta.note.trim()
          : `Status changed from ${statusWord(meta.statusChange.from)} to ${statusWord(meta.statusChange.to)}.`
        addComplaintEvent(
          active,
          actor,
          existing.id,
          'status',
          note,
          meta.statusChange.from,
          meta.statusChange.to,
        )
        usedNote = Boolean(meta.note?.trim())
      }
      if (meta.assignedChange) {
        const toName = meta.assignedChange.to
          ? db.getUser(meta.assignedChange.to)?.displayName ?? meta.assignedChange.to
          : null
        addComplaintEvent(
          active,
          actor,
          existing.id,
          'assigned',
          toName ? `Assigned to ${toName}.` : 'Assignment removed.',
          null,
          null,
        )
      }
      if (meta.categoryChange) {
        addComplaintEvent(
          active,
          actor,
          existing.id,
          'category',
          `Category changed from ${meta.categoryChange.from} to ${meta.categoryChange.to}.`,
          null,
          null,
        )
      }
      if (!usedNote && meta.note?.trim()) {
        addComplaintEvent(active, actor, existing.id, 'note', meta.note.trim(), null, null)
      }
    }

    writeAudit(active, actor, 'update', entity, existing.id, `Updated ${describeRecord(entity, result.record)}.`, {
      fields: Object.keys(body.data).filter((key) => key !== 'photoDataUrl'),
    })
    sendJson(res, 200, { record: result.record, meta: result.meta })
  }

  function handleRecordDelete(
    req: IncomingMessage,
    res: ServerResponse,
    entity: string,
    id: string,
  ): void {
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    const actor = actorFrom(session, active)
    const existing = getRecordForActive(active, entity, id)
    const ctx = validationContext(actor, active.collegeId, 'ui')
    if (!canDelete(existing, ctx)) {
      throw new HttpError(403, 'Your role cannot delete this record.')
    }
    const guard = deletionGuard(db, existing)
    if (guard) throw new HttpError(409, guard)
    db.deleteRecord(existing.id)
    if (entity === 'complaints') {
      for (const update of db
        .listRecords('complaintUpdates', active.collegeId)
        .filter((record) => String(record.data.complaintId ?? '') === existing.id)) {
        db.deleteRecord(update.id)
      }
    }
    writeAudit(active, actor, 'delete', entity, existing.id, `Deleted ${describeRecord(entity, existing.data)}.`)
    sendJson(res, 200, { ok: true })
  }

  /* -------------------------------------------------------------- */
  /* Attendance                                                     */
  /* -------------------------------------------------------------- */

  async function handleAttendanceSave(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    const actor = actorFrom(session, active)
    if (active.role !== 'admin' && active.role !== 'faculty') {
      throw new HttpError(403, 'Only faculty and administrators can log attendance.')
    }

    const body = await readJson(req)
    const slotId = typeof body.slotId === 'string' ? body.slotId.trim() : ''
    const sessionDate = typeof body.sessionDate === 'string' ? body.sessionDate.trim() : ''
    if (!slotId) throw new HttpError(422, 'Choose a timetabled session.', { fieldErrors: { slotId: 'Choose a session.' } })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
      throw new HttpError(422, 'Choose the session date.', { fieldErrors: { sessionDate: 'Choose the session date.' } })
    }
    const todayKey = istDateKey(new Date())
    if (todayKey && sessionDate > todayKey) {
      throw new HttpError(422, 'Attendance cannot be logged for a future date.', {
        fieldErrors: { sessionDate: 'Attendance cannot be logged for a future date.' },
      })
    }

    const slot = db.getRecord(slotId)
    if (!slot || slot.entity !== 'timetableSlots' || slot.collegeId !== active.collegeId) {
      throw new HttpError(404, 'That timetabled session is not in this college.')
    }
    const expectedDate = istDateKey(String(slot.data.startsAt))
    if (expectedDate && expectedDate !== sessionDate) {
      throw new HttpError(422, `This session is on ${expectedDate} in IST. Choose that date to log it.`, {
        fieldErrors: { sessionDate: `This session is on ${expectedDate}.` },
      })
    }
    // A session can share today's date and still not have started. Attendance
    // is only ever a record of a session that has begun.
    const startsAt = Date.parse(String(slot.data.startsAt ?? ''))
    if (!Number.isNaN(startsAt) && startsAt > Date.now()) {
      throw new HttpError(422, 'This session has not started yet, so attendance cannot be logged.', {
        fieldErrors: { sessionDate: 'This session has not started yet.' },
      })
    }

    const enrolledRaw = slot.data.expectedAttendance
    if (enrolledRaw === null || enrolledRaw === undefined || String(enrolledRaw).trim() === '') {
      throw new HttpError(
        422,
        'The timetable does not record an expected class size for this session, so over-enrolment cannot be checked. Add expected attendance to the booking first.',
        { fieldErrors: { present: 'Expected attendance is not recorded for this session.' } },
      )
    }
    const enrolled = Number(enrolledRaw)
    if (!Number.isInteger(enrolled) || enrolled < 0) {
      throw new HttpError(422, 'The expected class size on this booking is not a valid number.')
    }

    if (typeof body.present !== 'number' || !Number.isInteger(body.present) || body.present < 0) {
      throw new HttpError(422, 'Present must be a whole number, zero or more.', {
        fieldErrors: { present: 'Present must be a whole number, zero or more.' },
      })
    }
    const present = body.present
    if (present > enrolled) {
      throw new HttpError(422, `Only ${enrolled} students are enrolled in this class. Present cannot be higher.`, {
        fieldErrors: { present: `Only ${enrolled} students are enrolled.` },
      })
    }

    const rawReasons = body.reasons === undefined || body.reasons === null ? [] : body.reasons
    if (!Array.isArray(rawReasons)) {
      throw new HttpError(422, 'Reasons must be a list.', { fieldErrors: { reasons: 'Reasons must be a list.' } })
    }
    const reasons: AttendanceReason[] = []
    for (const value of rawReasons) {
      const reason = String(value) as AttendanceReason
      if (!ATTENDANCE_REASONS.includes(reason)) {
        throw new HttpError(422, 'Choose only the listed lecture reasons.', {
          fieldErrors: { reasons: 'Choose only the listed lecture reasons.' },
        })
      }
      if (!reasons.includes(reason)) reasons.push(reason)
    }

    const now = new Date().toISOString()
    const existing = db
      .listRecords('attendanceRecords', active.collegeId)
      .find(
        (record) =>
          String(record.data.slotId ?? '') === slotId &&
          String(record.data.sessionDate ?? '') === sessionDate,
      )

    let record: AttendanceRecord
    let created: boolean
    if (existing) {
      record = {
        ...(existing.data as unknown as AttendanceRecord),
        present,
        enrolled,
        reasons,
        recordedByUserId: actor.id,
        recordedByName: actor.displayName,
        updatedAt: now,
      }
      db.updateRecord(existing.id, record as unknown as Record<string, unknown>)
      created = false
    } else {
      const id = `att-${randomUUID()}`
      record = {
        id,
        collegeId: active.collegeId,
        slotId,
        sessionDate,
        present,
        enrolled,
        reasons,
        recordedByUserId: actor.id,
        recordedByName: actor.displayName,
        recordedAt: now,
        updatedAt: now,
      }
      db.insertRecord({
        id,
        entity: 'attendanceRecords',
        collegeId: active.collegeId,
        ownerId: actor.id,
        data: record as unknown as Record<string, unknown>,
        source: 'ui',
      })
      created = true
    }

    // Keep the timetable's actual-attendance field in step with the saved
    // record. The field already exists; nothing is renamed or replaced.
    db.updateRecord(slot.id, { ...slot.data, attendance: present })

    writeAudit(
      active,
      actor,
      created ? 'create' : 'update',
      'attendanceRecords',
      record.id,
      created
        ? `Logged ${present} of ${enrolled} present for "${String(slot.data.activity ?? 'session')}" on ${sessionDate}.`
        : `Updated attendance to ${present} of ${enrolled} for "${String(slot.data.activity ?? 'session')}" on ${sessionDate}.`,
      { slotId, sessionDate, present, enrolled, reasons },
    )
    sendJson(res, created ? 201 : 200, { record, created })
  }

  /* -------------------------------------------------------------- */
  /* Maintenance jobs                                               */
  /* -------------------------------------------------------------- */

  /**
   * Jobs belong to the maintenance role only. Students, faculty, estates and
   * administrators all receive 403 here; anonymous callers receive 401 from
   * requireSession before this point is reached.
   */
  function maintenanceContext(req: IncomingMessage): { active: ActiveCollege; actor: Actor } {
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    const actor = actorFrom(session, active)
    if (active.role !== 'maintenance') {
      throw new HttpError(403, 'Only the maintenance team works on jobs.')
    }
    return { active, actor }
  }

  function myJobRecord(active: ActiveCollege, actor: Actor, id: string): StoredRecord {
    const record = id ? db.getRecord(id) : undefined
    if (!record || record.entity !== 'complaints' || record.collegeId !== active.collegeId) {
      throw new HttpError(404, 'That job is not in this college.')
    }
    if (String(record.data.assignedToUserId ?? '') !== actor.id) {
      throw new HttpError(403, 'That job is assigned to someone else.')
    }
    return record
  }

  function myInspectionRecord(active: ActiveCollege, actor: Actor, id: string): StoredRecord {
    const record = id ? db.getRecord(id) : undefined
    if (!record || record.entity !== 'inspections' || record.collegeId !== active.collegeId) {
      throw new HttpError(404, 'That inspection is not in this college.')
    }
    const inspector = String(record.data.inspectorUserId ?? '')
    if (inspector && inspector !== actor.id) {
      throw new HttpError(403, 'That inspection is assigned to someone else.')
    }
    return record
  }

  function jobView(active: ActiveCollege, complaint: Complaint, asOf: string): JobCard {
    const rooms = dataOfList<Room>(db.listRecords('rooms', active.collegeId))
    const buildings = dataOfList<Building>(db.listRecords('buildings', active.collegeId))
    const assets = dataOfList<Asset>(db.listRecords('assets', active.collegeId))
    return buildJobCards([complaint], rooms, buildings, assets, asOf)[0]
  }

  function maintenanceJobCards(active: ActiveCollege, actor: Actor, asOf: string): JobCard[] {
    const complaints = db
      .listRecords('complaints', active.collegeId)
      .filter((record) => String(record.data.assignedToUserId ?? '') === actor.id)
      .map((record) => record.data as unknown as Complaint)
    return buildJobCards(
      complaints,
      dataOfList<Room>(db.listRecords('rooms', active.collegeId)),
      dataOfList<Building>(db.listRecords('buildings', active.collegeId)),
      dataOfList<Asset>(db.listRecords('assets', active.collegeId)),
      asOf,
    )
  }

  function maintenanceInspections(active: ActiveCollege, actor: Actor, asOf: string): InspectionCard[] {
    const inspections = db
      .listRecords('inspections', active.collegeId)
      .filter((record) => String(record.data.inspectorUserId ?? '') === actor.id)
      .map((record) => record.data as unknown as Inspection)
    return buildInspectionCards(inspections, dataOfList<Asset>(db.listRecords('assets', active.collegeId)), asOf)
  }

  async function handleJobsRead(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { active, actor } = maintenanceContext(req)
    const serverTime = new Date().toISOString()
    const jobs = maintenanceJobCards(active, actor, serverTime)
    const inspections = maintenanceInspections(active, actor, serverTime)
    sendJson(res, 200, {
      jobs,
      counts: {
        todo: jobs.filter((job) => job.group === 'todo').length,
        progress: jobs.filter((job) => job.group === 'progress').length,
        done: jobs.filter((job) => job.group === 'done').length,
      },
      inspections,
      inspectionsDue: inspectionsDue(inspections).length,
      college: { id: active.collegeId, name: active.collegeName },
      serverTime,
    })
  }

  async function handleJobMove(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
    move: 'start' | 'complete',
  ): Promise<void> {
    const { active, actor } = maintenanceContext(req)
    const record = myJobRecord(active, actor, id)
    const complaint = record.data as unknown as Complaint
    const ticket = complaint.ticketNumber ?? complaint.id

    // The machine only ever moves To do -> In progress -> Done.
    if (move === 'start' && complaint.status !== 'open') {
      throw new HttpError(
        409,
        complaint.status === 'in_progress' ? 'This job is already in progress.' : 'This job is already finished.',
      )
    }
    if (move === 'complete') {
      if (complaint.status === 'open') {
        throw new HttpError(422, 'Start the job before marking it done.')
      }
      if (complaint.status !== 'in_progress') {
        throw new HttpError(409, 'This job is already finished.')
      }
    }

    const body = await readJson(req)
    let note: string | null = null
    let photo: { name: string | null; dataUrl: string | null } = { name: null, dataUrl: null }
    if (move === 'complete') {
      note = typeof body.note === 'string' ? body.note.trim() : ''
      if (note.length < 10) {
        throw new HttpError(422, 'Write what you did, at least 10 characters.', {
          fieldErrors: { note: 'Write what you did, at least 10 characters.' },
        })
      }
      if (note.length > 1000) {
        throw new HttpError(422, 'That note is too long.', { fieldErrors: { note: 'Keep the note under 1000 characters.' } })
      }
      const photoErrors: Record<string, string> = {}
      photo = validPhoto({ photoName: body.photoName, photoDataUrl: body.photoDataUrl }, photoErrors)
      if (Object.keys(photoErrors).length > 0) {
        throw new HttpError(422, photoErrors.photoDataUrl ?? 'That photo was not accepted.', {
          fieldErrors: photoErrors,
        })
      }
    }

    const now = new Date().toISOString()
    const toStatus: ComplaintStatus = move === 'start' ? 'in_progress' : 'resolved'
    const data: Record<string, unknown> =
      move === 'start'
        ? { ...record.data, status: toStatus }
        : {
            ...record.data,
            status: toStatus,
            resolvedAt: now,
            completionNote: note,
            completionPhotoName: photo.name,
            completionPhotoDataUrl: photo.dataUrl,
          }
    db.updateRecord(record.id, data)

    addComplaintEvent(
      active,
      actor,
      complaint.id,
      'status',
      move === 'start' ? 'Maintenance started the job.' : `Maintenance marked the job done: ${note}`,
      complaint.status,
      toStatus,
    )
    writeAudit(
      active,
      actor,
      move === 'start' ? 'job_start' : 'job_complete',
      'complaints',
      complaint.id,
      move === 'start'
        ? `Started job ${ticket}: ${complaint.category} at ${String(complaint.roomId ?? complaint.assetId ?? 'place not recorded')}.`
        : `Marked job ${ticket} done. Note: ${note}`,
      {
        jobId: complaint.id,
        move,
        ticketNumber: complaint.ticketNumber ?? null,
        fromStatus: complaint.status,
        toStatus,
        note,
        photoName: photo.name,
      },
    )
    sendJson(res, 200, { job: jobView(active, data as unknown as Complaint, now) })
  }

  async function handleInspectionRecord(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { active, actor } = maintenanceContext(req)
    const body = await readJson(req)
    const id = typeof body.inspectionId === 'string' ? body.inspectionId.trim() : ''
    const record = myInspectionRecord(active, actor, id)
    const inspection = record.data as unknown as Inspection
    if (inspection.status === 'completed') {
      throw new HttpError(409, 'This inspection is already recorded.')
    }

    const result = typeof body.result === 'string' ? body.result.trim() : ''
    if (!INSPECTION_RESULTS.includes(result as InspectionResult)) {
      throw new HttpError(422, 'Choose what the inspection found.', {
        fieldErrors: { result: 'Choose what the inspection found.' },
      })
    }
    const note = typeof body.note === 'string' ? body.note.trim() : ''
    if (note.length < 3) {
      throw new HttpError(422, 'Add a short note about what you found.', {
        fieldErrors: { note: 'Add a short note about what you found.' },
      })
    }
    if (note.length > 500) {
      throw new HttpError(422, 'That note is too long.', { fieldErrors: { note: 'Keep the note under 500 characters.' } })
    }

    const now = new Date().toISOString()
    db.updateRecord(record.id, {
      ...record.data,
      status: 'completed',
      // The date is written by the server, not by the browser.
      completedAt: now,
      result,
      findings: note,
      inspectorUserId: inspection.inspectorUserId ?? actor.id,
    })
    writeAudit(
      active,
      actor,
      'inspection_record',
      'inspections',
      inspection.id,
      `Recorded inspection ${inspection.id} (${result}) for asset ${inspection.assetId}.`,
      { jobId: inspection.id, assetId: inspection.assetId, result, note },
    )
    sendJson(res, 200, {
      inspection: {
        ...(record.data as Record<string, unknown>),
        status: 'completed',
        completedAt: now,
        result,
        findings: note,
      },
    })
  }

  /* -------------------------------------------------------------- */
  /* Decisions                                                      */
  /* -------------------------------------------------------------- */

  async function handleDecisionCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    const actor = actorFrom(session, active)
    if (!hasCapability(active.role, 'view-plan')) {
      throw new HttpError(403, 'Your role cannot record planning decisions.')
    }
    const body = await readJson(req)
    const data = isRecord(body.data) ? body.data : body
    const optionId = typeof data.optionId === 'string' ? data.optionId.trim() : ''
    const option = optionId ? db.getRecord(optionId) : null
    if (!option || option.entity !== 'planOptions' || option.collegeId !== active.collegeId) {
      throw new HttpError(422, 'Choose a plan option from this college.', {
        fieldErrors: { optionId: 'Option not found in this college.' },
      })
    }
    const title = requiredText(data.title, 'Title', 200)
    const ownerUserId = optionalUser(db, data.ownerUserId, active.collegeId, ['admin', 'estates', 'maintenance'])
    const followUp = optionalText(data.followUp, 4000) ?? ''
    const notes = optionalText(data.notes, 4000) ?? ''
    const now = new Date().toISOString()
    const id = `dec-${randomUUID()}`
    const record: Decision = {
      id,
      collegeId: active.collegeId,
      optionId,
      title,
      status: 'proposed',
      decidedByUserId: null,
      decidedAt: null,
      ownerUserId,
      followUp,
      notes,
      createdAt: now,
    }
    db.insertRecord({ id, entity: 'decisions', collegeId: active.collegeId, data: { ...record }, source: 'ui' })
    writeAudit(active, actor, 'create', 'decisions', id, `Recorded a proposed decision: ${title}.`)
    sendJson(res, 201, { record })
  }

  async function handleDecisionUpdate(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
  ): Promise<void> {
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    const actor = actorFrom(session, active)
    if (!hasCapability(active.role, 'view-plan')) {
      throw new HttpError(403, 'Your role cannot update planning decisions.')
    }
    const existing = db.getRecord(id)
    if (!existing || existing.entity !== 'decisions' || existing.collegeId !== active.collegeId) {
      throw new HttpError(404, 'Decision not found.')
    }
    const body = await readJson(req)
    const patch = isRecord(body.data) ? body.data : body
    const record = { ...(existing.data as unknown as Decision) }
    const allowed = new Set(['title', 'ownerUserId', 'followUp', 'notes', 'status'])
    const extra = Object.keys(patch).filter((key) => !allowed.has(key))
    if (extra.length > 0) throw new HttpError(400, `Cannot update: ${extra.join(', ')}.`)
    if (patch.title !== undefined) record.title = requiredText(patch.title, 'Title', 200)
    if (patch.ownerUserId !== undefined) {
      record.ownerUserId = optionalUser(db, patch.ownerUserId, active.collegeId, [
        'admin',
        'estates',
        'maintenance',
      ])
    }
    if (patch.followUp !== undefined) record.followUp = optionalText(patch.followUp, 4000) ?? ''
    if (patch.notes !== undefined) record.notes = optionalText(patch.notes, 4000) ?? ''
    if (patch.status !== undefined) {
      if (active.role !== 'admin') {
        throw new HttpError(403, 'Only an administrator can approve, reject or defer a decision.')
      }
      const status = String(patch.status) as Decision['status']
      if (!['proposed', 'approved', 'rejected', 'deferred'].includes(status)) {
        throw new HttpError(422, 'Invalid decision status.')
      }
      record.status = status
      record.decidedByUserId = status === 'proposed' ? null : actor.id
      record.decidedAt = status === 'proposed' ? null : new Date().toISOString()
    }
    db.updateRecord(id, record as unknown as Record<string, unknown>)
    writeAudit(
      active,
      actor,
      'update',
      'decisions',
      id,
      `Updated decision "${record.title}"${patch.status ? ` — status ${record.status}` : ''}.`,
      { fields: Object.keys(patch) },
    )
    sendJson(res, 200, { record })
  }

  /* -------------------------------------------------------------- */
  /* Member roles                                                   */
  /* -------------------------------------------------------------- */

  async function handleMemberCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    const actor = actorFrom(session, active)
    if (!hasCapability(active.role, 'manage-users')) {
      throw new HttpError(403, 'Only an administrator can create staff accounts.')
    }
    const body = await readJson(req)
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const role = asRole(String(body.role ?? ''))
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      throw new HttpError(422, 'Username must be 3-32 letters, numbers, dots, underscores or hyphens.')
    }
    if (displayName.length < 2 || displayName.length > 80) {
      throw new HttpError(422, 'Display name must be 2-80 characters.')
    }
    if (password.length < 10 || password.length > 200) {
      throw new HttpError(422, 'Password must be at least 10 characters.')
    }
    if (role !== 'admin' && role !== 'estates' && role !== 'maintenance') {
      throw new HttpError(422, 'Staff accounts must be administrator, estates or maintenance.')
    }
    if (db.getUserByUsername(username)) {
      throw new HttpError(409, 'That username is already in use.')
    }
    const id = `usr-${randomUUID()}`
    try {
      db.createAccount({
        id,
        username,
        displayName,
        password,
        collegeId: active.collegeId,
        role,
        sample: false,
      })
    } catch {
      throw new HttpError(409, 'That username is already in use.')
    }
    writeAudit(active, actor, 'create', 'user', id, `Created a ${role} account for ${displayName}.`)
    sendJson(res, 201, {
      members: db.listCollegeMembers(active.collegeId).map((member) => ({
        id: member.id,
        displayName: member.displayName,
        role: member.role as UserRole,
        sample: member.sample,
      })),
    })
  }

  async function handleMemberRole(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    const actor = actorFrom(session, active)
    if (!hasCapability(active.role, 'manage-users')) {
      throw new HttpError(403, 'Only an administrator can change roles.')
    }
    const body = await readJson(req)
    const role = asRole(String(body.role ?? ''))
    if (!role) throw new HttpError(422, 'Choose a valid role.')
    const target = db.membershipRole(userId, active.collegeId)
    if (!target) throw new HttpError(404, 'That account is not a member of this college.')
    if (userId === actor.id && role !== 'admin') {
      throw new HttpError(400, 'You cannot remove your own administrator role. Ask another administrator.')
    }
    db.setMembershipRole(userId, active.collegeId, role)
    writeAudit(
      active,
      actor,
      'role',
      'membership',
      userId,
      `Changed role for ${db.getUser(userId)?.displayName ?? userId} from ${target} to ${role}.`,
    )
    sendJson(res, 200, {
      members: db.listCollegeMembers(active.collegeId).map((member) => ({
        id: member.id,
        displayName: member.displayName,
        role: member.role as UserRole,
        sample: member.sample,
      })),
    })
  }

  /* -------------------------------------------------------------- */
  /* Import                                                         */
  /* -------------------------------------------------------------- */

  async function handleImport(
    req: IncomingMessage,
    res: ServerResponse,
    preview: boolean,
  ): Promise<void> {
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    const actor = actorFrom(session, active)
    if (!hasCapability(active.role, 'import-data')) {
      throw new HttpError(403, 'Only administrators and estates staff can import data.')
    }
    const body = await readJson(req, 25_000_000)
    const request = parseImportRequest(body)
    const hasPublic = request.sheets.some((sheet) => ENTITY_BY_NAME.get(sheet.entity)?.scope === 'public')
    if (hasPublic && active.role !== 'admin') {
      throw new HttpError(403, 'Only an administrator can import public infrastructure records.')
    }
    if (!preview && request.mode === 'replace' && request.confirmReplace !== true) {
      throw new HttpError(400, 'Replace mode needs explicit confirmation. Nothing was changed.')
    }
    if (request.mode === 'replace' && hasPublic) {
      throw new HttpError(400, 'Replace mode applies to campus records only. Import public records in append mode.')
    }
    const outcome = runImport(db, actor, active, request, !preview)
    sendJson(res, 200, outcome)
  }

  function parseImportRequest(body: Record<string, unknown>): ImportRequest {
    const fileName = optionalText(body.fileName, 220)
    if (!fileName) throw new HttpError(400, 'Provide the source file name.')
    const mode = body.mode === 'replace' ? 'replace' : body.mode === 'append' ? 'append' : null
    if (!mode) throw new HttpError(400, 'Choose append or replace mode.')
    if (!Array.isArray(body.sheets) || body.sheets.length === 0) {
      throw new HttpError(400, 'Choose at least one sheet or data category to import.')
    }
    const sheets: ImportSheetInput[] = []
    const seen = new Set<string>()
    let totalRows = 0
    for (const rawSheet of body.sheets) {
      if (!isRecord(rawSheet)) throw new HttpError(400, 'Each sheet must be an object.')
      const entity = String(rawSheet.entity ?? '')
      const spec = ENTITY_BY_NAME.get(entity)
      if (!spec || !spec.importable) throw new HttpError(400, `Unknown data category "${entity}".`)
      if (seen.has(entity)) throw new HttpError(400, `The category "${spec.label}" appears twice.`)
      seen.add(entity)
      if (!Array.isArray(rawSheet.rows)) throw new HttpError(400, `Rows for ${spec.label} must be a list.`)
      if (rawSheet.rows.length > 4000) {
        throw new HttpError(400, `${spec.label} has too many rows for one import (maximum 4,000).`)
      }
      totalRows += rawSheet.rows.length
      const rows: Record<string, unknown>[] = []
      for (const row of rawSheet.rows) {
        if (!isRecord(row)) throw new HttpError(400, `A row in ${spec.label} is not an object.`)
        rows.push({ ...row })
      }
      sheets.push({ entity, rows })
    }
    if (totalRows > 12_000) throw new HttpError(400, 'This import has too many rows in total (maximum 12,000).')
    if (totalRows === 0) throw new HttpError(400, 'The selected sheets contain no rows.')
    return { fileName, mode, sheets, confirmReplace: body.confirmReplace === true }
  }

  function runImport(
    database: Database,
    actor: Actor,
    active: ActiveCollege,
    request: ImportRequest,
    write: boolean,
  ): ImportOutcome {
    const importId = `imp-${randomUUID()}`
    const replace = request.mode === 'replace'
    const included = new Set(request.sheets.map((sheet) => sheet.entity))
    const blocked: string[] = []
    const notices: string[] = []

    if (replace) {
      const populated = CAMPUS_ENTITIES.filter(
        (entity) => database.countEntity(entity, active.collegeId) > 0,
      )
      const missing = populated.filter((entity) => !included.has(entity))
      if (missing.length > 0) {
        blocked.push(
          `Replace blocked: the current college has records in ${missing
            .map((entity) => ENTITY_BY_NAME.get(entity)?.label ?? entity)
            .join(', ')}, but those categories are not in this file. Include every populated category, or use Append.`,
        )
      }
      notices.push(
        'Replace mode removes existing campus records in the supplied categories, including related complaint updates and decisions. The audit log and import history are retained.',
      )
    }
    if (request.sheets.some((sheet) => ENTITY_BY_NAME.get(sheet.entity)?.scope === 'public')) {
      notices.push(
        'Public infrastructure records are shared across all colleges and are visible to every signed-in user.',
      )
    }

    const entityOutcomes = new Map<string, ImportEntityOutcome>()
    for (const sheet of request.sheets) {
      const spec = ENTITY_BY_NAME.get(sheet.entity)
      entityOutcomes.set(sheet.entity, {
        entity: sheet.entity,
        label: spec?.label ?? sheet.entity,
        imported: 0,
        skipped: 0,
        rejected: 0,
        rows: [],
      })
    }

    const finish = (applied: boolean, canApply: boolean): ImportOutcome => {
      const entities = request.sheets
        .map((sheet) => entityOutcomes.get(sheet.entity))
        .filter((item): item is ImportEntityOutcome => Boolean(item))
      const totals = entities.reduce(
        (sum, item) => ({
          imported: sum.imported + item.imported,
          skipped: sum.skipped + item.skipped,
          rejected: sum.rejected + item.rejected,
        }),
        { imported: 0, skipped: 0, rejected: 0 },
      )
      return {
        fileName: request.fileName,
        mode: request.mode,
        preview: !write,
        applied,
        canApply,
        blocked,
        notices,
        entities,
        totals,
        importId: applied ? importId : null,
      }
    }

    if (blocked.length > 0) return finish(false, false)

    const prepared = new Map<string, PreparedRow[]>()
    for (const sheet of request.sheets) {
      prepared.set(
        sheet.entity,
        sheet.rows.map((raw, index) => ({ rowNumber: index + 2, raw, warnings: [] })),
      )
    }

    database.sql.exec('BEGIN IMMEDIATE')
    let committed = false
    try {
      if (replace) {
        for (const entity of included) {
          if (CAMPUS_ENTITIES.includes(entity)) database.deleteCollegeEntityRecords(entity, active.collegeId)
        }
        if (included.has('complaints')) {
          database.deleteCollegeEntityRecords('complaintUpdates', active.collegeId)
        }
        if (included.has('planOptions')) {
          database.deleteCollegeEntityRecords('decisions', active.collegeId)
        }
      }

      prepareImportedRows(database, prepared, active, included, replace)

      const ctx = validationContext(actor, active.collegeId, 'import')
      for (const entity of IMPORT_ORDER) {
        const rows = prepared.get(entity)
        const outcome = entityOutcomes.get(entity)
        if (!rows || !outcome) continue
        const spec = ENTITY_BY_NAME.get(entity)
        if (!spec) continue
        for (const row of rows) {
          const suppliedId = row.raw.id === undefined || row.raw.id === null ? '' : String(row.raw.id).trim()
          if (suppliedId && database.getRecord(suppliedId)) {
            pushRow(outcome, row, 'skipped', suppliedId, 'A record with this ID already exists; the row was skipped.', {})
            continue
          }
          const result = createEntityRecord(entity, row.raw, ctx)
          if (!result.ok) {
            if (result.error.includes('duplicate natural key')) {
              pushRow(outcome, row, 'skipped', suppliedId || null, 'Duplicate of an existing record; the row was skipped.', {})
            } else {
              pushRow(outcome, row, 'rejected', suppliedId || null, result.error, result.fieldErrors)
            }
            continue
          }
          const data = result.record
          const id = String(data.id)
          database.insertRecord({
            id,
            entity,
            collegeId: spec.scope === 'campus' ? active.collegeId : null,
            ownerId:
              entity === 'complaints' || entity === 'urbanIssues'
                ? String(data.reporterId ?? actor.id)
                : null,
            data,
            source: 'import',
            importId,
          })
          pushRow(outcome, row, 'imported', id, null, {}, dataWarnings(entity, data))
        }
      }

      const entities = [...entityOutcomes.values()]
      const rejected = entities.reduce((sum, item) => sum + item.rejected, 0)
      const canApply = !(replace && rejected > 0)
      if (!write) {
        database.sql.exec('ROLLBACK')
        return finish(false, canApply)
      }
      if (!canApply) {
        database.sql.exec('ROLLBACK')
        return finish(false, false)
      }
      database.sql.exec('COMMIT')
      committed = true
    } catch (error) {
      if (!committed) {
        try {
          database.sql.exec('ROLLBACK')
        } catch {
          /* the transaction is already closed */
        }
      }
      throw error
    }

    const entities = [...entityOutcomes.values()]
    const summary = entities
      .filter((item) => item.rows.length > 0)
      .map((item) => ({
        entity: item.entity,
        imported: item.imported,
        skipped: item.skipped,
        rejected: item.rejected,
      }))
    const totalImported = summary.reduce((sum, item) => sum + item.imported, 0)
    db.addImportLog({
      id: importId,
      collegeId: active.collegeId,
      actorName: actor.displayName,
      fileName: request.fileName,
      kind: 'import',
      mode: request.mode,
      totalImported,
      summary,
    })
    writeAudit(
      active,
      actor,
      'import',
      'workspace',
      null,
      `Imported ${totalImported} record${totalImported === 1 ? '' : 's'} from ${request.fileName} (${request.mode}).`,
      {
        fileName: request.fileName,
        mode: request.mode,
        totals: summary.reduce(
          (sum, item) => ({
            imported: sum.imported + item.imported,
            skipped: sum.skipped + item.skipped,
            rejected: sum.rejected + item.rejected,
          }),
          { imported: 0, skipped: 0, rejected: 0 },
        ),
      },
    )
    return finish(true, true)
  }

  /* -------------------------------------------------------------- */
  /* Auth routes                                                    */
  /* -------------------------------------------------------------- */

  async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req)
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const chosenCollegeId = typeof body.collegeId === 'string' ? body.collegeId.trim() : ''
    const chosenRoleRaw = typeof body.role === 'string' ? body.role.trim() : ''
    if (!username || !password) throw new HttpError(400, 'Enter your username and password.')
    if (chosenRoleRaw && !asRole(chosenRoleRaw)) {
      throw new HttpError(422, 'Choose a valid role.')
    }
    const chosenRole = asRole(chosenRoleRaw)
    const key = `${clientAddress(req)}|${username.toLowerCase()}`
    bumpLimit(loginAttempts, key, LOGIN_LIMIT, LOGIN_WINDOW_MS, 'Too many sign-in attempts.')
    const user = db.getUserByUsername(username)
    const valid = user
      ? verifyPassword(password, user.salt, user.passwordHash)
      : (verifyPassword(password, DUMMY_SALT, DUMMY_HASH), false)
    if (!user || !valid) {
      throw new HttpError(401, 'The username or password is not correct.')
    }

    const memberships = db.getMemberships(user.id)
    if (memberships.length === 0) {
      throw new HttpError(403, 'This account has no college membership. Ask an administrator to add you.')
    }
    const membership = chosenCollegeId
      ? memberships.find((item) => item.collegeId === chosenCollegeId)
      : memberships[0]
    if (!membership) {
      throw new HttpError(403, 'This account is not a member of that college.', {
        code: 'college-forbidden',
      })
    }
    const realRole = asRole(membership.role)
    if (chosenRole && chosenRole !== realRole) {
      throw new HttpError(403, `This account is not a ${chosenRole} account.`, {
        code: 'role-mismatch',
      })
    }

    loginAttempts.delete(key)
    const token = db.createSession(user.id, SESSION_TTL_MS)
    setSessionCookie(res, token)
    const session: SessionRecord = {
      token,
      user: { id: user.id, username: user.username, displayName: user.displayName, sample: user.sample },
      memberships,
    }
    sendJson(res, 200, { session: toSessionInfo(session) })
  }

  function handleDemoAccounts(res: ServerResponse): void {
    const enabled = env.DEMO_MODE === 'true'
    if (!enabled) {
      sendJson(res, 200, { enabled: false, accounts: [] })
      return
    }
    const collegeNames = new Map(db.listColleges().map((college) => [college.id, college.name]))
    const accounts = (['admin', 'estates', 'maintenance', 'faculty', 'student'] as const)
      .map((role) => SAMPLE_ACCOUNTS.find((account) => account.role === role && account.collegeId === 'clg-bv'))
      .filter((account): account is (typeof SAMPLE_ACCOUNTS)[number] => Boolean(account))
      .map((account) => ({
        role: account.role,
        username: account.username,
        password: account.password,
        collegeId: account.collegeId,
        collegeName: collegeNames.get(account.collegeId) ?? account.collegeId,
      }))
    sendJson(res, 200, { enabled: true, accounts })
  }

  async function handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    bumpLimit(
      registerAttempts,
      clientAddress(req),
      10,
      60 * 60 * 1000,
      'Too many new accounts from this device.',
    )
    const body = await readJson(req)
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const collegeCode = typeof body.collegeCode === 'string' ? body.collegeCode.trim() : ''
    const role = body.role === 'student' || body.role === 'faculty' ? body.role : null
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
      throw new HttpError(422, 'Username must be 3-32 letters, numbers, dots, underscores or hyphens.')
    }
    if (displayName.length < 2 || displayName.length > 80) {
      throw new HttpError(422, 'Display name must be 2-80 characters.')
    }
    if (password.length < 10 || password.length > 200) {
      throw new HttpError(422, 'Password must be at least 10 characters.')
    }
    if (!role) {
      throw new HttpError(422, 'Self-registration is available for student and faculty accounts only.')
    }
    if (!collegeCode) {
      throw new HttpError(422, 'Enter the college code.', {
        fieldErrors: { collegeCode: 'Enter the college code.' },
      })
    }
    const college = db.findCollegeByCode(collegeCode)
    if (!college) {
      throw new HttpError(422, 'That college code is not recognised.', {
        fieldErrors: { collegeCode: 'That college code is not recognised.' },
      })
    }
    if (db.getUserByUsername(username)) {
      throw new HttpError(409, 'That username is already in use.')
    }
    const id = `usr-${randomUUID()}`
    try {
      db.createAccount({ id, username, displayName, password, collegeId: college.id, role, sample: false })
    } catch {
      throw new HttpError(409, 'That username is already in use.')
    }
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), {
      token: '',
      user: { id, username, displayName, sample: false },
      memberships: db.getMemberships(id),
    }, college.id)
    writeAudit(
      active,
      { id, displayName, role },
      'register',
      'user',
      id,
      `Created a ${role} account with membership of ${active.collegeName}.`,
    )
    const token = db.createSession(id, SESSION_TTL_MS)
    setSessionCookie(res, token)
    sendJson(res, 201, {
      session: toSessionInfo({
        token,
        user: { id, username, displayName, sample: false },
        memberships: db.getMemberships(id),
      }),
    })
  }

  /* -------------------------------------------------------------- */
  /* AI proxy                                                       */
  /* -------------------------------------------------------------- */

  async function handleAiAssist(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    const body = await readJson(req, 2_000_000)
    const task = String(body.task ?? '') as AiTask
    const allowedTasks: Record<UserRole, AiTask[]> = {
      admin: ['explain-finding', 'report-summary', 'option-comparison', 'categorise-issue', 'ask-data'],
      estates: ['explain-finding', 'report-summary', 'option-comparison', 'categorise-issue', 'ask-data'],
      maintenance: ['explain-finding', 'categorise-issue'],
      faculty: ['categorise-issue'],
      student: ['categorise-issue'],
    }
    if (!allowedTasks[active.role].includes(task)) {
      throw new HttpError(403, 'Your role cannot use this AI task.')
    }
    if (!isRecord(body.facts) && !Array.isArray(body.facts)) {
      throw new HttpError(400, 'The request must include computed facts for the assistant.')
    }
    const question = typeof body.question === 'string' ? body.question.slice(0, 500) : undefined
    bumpLimit(aiUsage, session.user.id, 15, 60_000, 'The assistant has been used frequently.')
    if (!aiSettings) {
      sendJson(res, 503, {
        ok: false,
        configured: false,
        error:
          'AI is not configured on the server. Rule-based explanations are available and are clearly labelled.',
        text: null,
        model: null,
      })
      return
    }
    const answer = await runAiTask(aiSettings, task, body.facts, question)
    if (!answer.ok) {
      sendJson(res, 502, {
        ok: false,
        configured: true,
        error: answer.error,
        text: null,
        model: answer.model,
      })
      return
    }
    sendJson(res, 200, {
      ok: true,
      configured: true,
      text: answer.text,
      model: answer.model,
      label: 'AI-generated — please verify',
      checkedAt: new Date().toISOString(),
    })
  }

  /* -------------------------------------------------------------- */
  /* Router                                                         */
  /* -------------------------------------------------------------- */

  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? 'GET'
    const pathname = url.pathname.replace(/\/+$/, '') || '/'

    if (!pathname.startsWith('/api/') && pathname !== '/api') return
    if (method === 'OPTIONS') {
      throw new HttpError(405, 'Cross-origin requests are not enabled.')
    }

    if (method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'microcity-api',
        time: new Date().toISOString(),
        database: 'sqlite',
        dataset: readProvenance(db).name,
        aiConfigured: Boolean(aiSettings),
      })
      return
    }

    if (method === 'GET' && pathname === '/api/colleges') {
      sendJson(res, 200, { colleges: db.listColleges() })
      return
    }
    if (method === 'GET' && pathname === '/api/auth/demo') {
      handleDemoAccounts(res)
      return
    }

    if (method === 'POST' && pathname === '/api/auth/login') {
      await handleLogin(req, res)
      return
    }
    if (method === 'POST' && pathname === '/api/auth/register') {
      await handleRegister(req, res)
      return
    }
    if (method === 'POST' && pathname === '/api/auth/logout') {
      const session = getSession(req)
      if (session) db.deleteSession(session.token)
      clearSessionCookie(res)
      sendJson(res, 200, { ok: true })
      return
    }
    if (method === 'GET' && pathname === '/api/auth/me') {
      const session = getSession(req)
      sendJson(res, 200, { session: session ? toSessionInfo(session) : null })
      return
    }

    if (method === 'GET' && pathname === '/api/workspace') {
      const session = requireSession(req)
      const active = requireActive(req, url, session)
      sendJson(res, 200, buildWorkspace(session, active))
      return
    }

    if (method === 'GET' && pathname === '/api/ai/status') {
      requireSession(req)
      sendJson(res, 200, {
        configured: Boolean(aiSettings),
        model: aiSettings?.model ?? null,
        label: 'AI-generated — please verify',
      })
      return
    }
    if (method === 'POST' && pathname === '/api/ai/assist') {
      await handleAiAssist(req, res)
      return
    }

    if (method === 'POST' && pathname === '/api/import/preview') {
      await handleImport(req, res, true)
      return
    }
    if (method === 'POST' && pathname === '/api/import') {
      await handleImport(req, res, false)
      return
    }

    if (method === 'POST' && pathname === '/api/attendance') {
      await handleAttendanceSave(req, res)
      return
    }

    if (method === 'GET' && pathname === '/api/jobs') {
      await handleJobsRead(req, res)
      return
    }
    const jobMoveMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/(start|complete)$/)
    if (jobMoveMatch && method === 'POST') {
      await handleJobMove(req, res, decodeURIComponent(jobMoveMatch[1]), jobMoveMatch[2] as 'start' | 'complete')
      return
    }
    if (method === 'POST' && pathname === '/api/inspections/record') {
      await handleInspectionRecord(req, res)
      return
    }

    if (method === 'POST' && pathname === '/api/decisions') {
      await handleDecisionCreate(req, res)
      return
    }

    const decisionMatch = pathname.match(/^\/api\/decisions\/([^/]+)$/)
    if (decisionMatch && method === 'PATCH') {
      await handleDecisionUpdate(req, res, decodeURIComponent(decisionMatch[1]))
      return
    }

    if (pathname === '/api/members' && method === 'POST') {
      await handleMemberCreate(req, res)
      return
    }

    const memberMatch = pathname.match(/^\/api\/members\/([^/]+)$/)
    if (memberMatch && method === 'PATCH') {
      await handleMemberRole(req, res, decodeURIComponent(memberMatch[1]))
      return
    }

    const recordCreateMatch = pathname.match(/^\/api\/records\/([A-Za-z]+)$/)
    if (recordCreateMatch && method === 'POST') {
      await handleRecordCreate(req, res, recordCreateMatch[1])
      return
    }
    const recordItemMatch = pathname.match(/^\/api\/records\/([A-Za-z]+)\/([^/]+)$/)
    if (recordItemMatch) {
      const entity = recordItemMatch[1]
      const id = decodeURIComponent(recordItemMatch[2])
      if (method === 'PATCH') {
        await handleRecordUpdate(req, res, entity, id)
        return
      }
      if (method === 'DELETE') {
        handleRecordDelete(req, res, entity, id)
        return
      }
    }

    throw new HttpError(404, 'API route not found.')
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/api')) return false
    try {
      await route(req, res, url)
    } catch (error) {
      if (res.headersSent) {
        res.end()
        return true
      }
      if (error instanceof HttpError) {
        sendJson(res, error.status, {
          error: error.message,
          ...(isRecord(error.details) ? error.details : {}),
        })
      } else {
        console.error('[microcity-api]', error)
        sendJson(res, 500, { error: 'The server hit an unexpected error. Nothing was changed.' })
      }
    }
    return true
  }

  return { handle, db, aiConfigured: Boolean(aiSettings) }
}

/* ------------------------------------------------------------------ */
/* Module helpers                                                     */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Stored rows carry their fields as JSON; job views need the plain values. */
function dataOfList<T>(records: StoredRecord[]): T[] {
  return records.map((record) => ({ ...record.data }) as unknown as T)
}

function asRole(value: string): UserRole | null {
  return (ALL_ROLES as string[]).includes(value) ? (value as UserRole) : null
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    if (!key) continue
    try {
      cookies[key] = decodeURIComponent(part.slice(index + 1).trim())
    } catch {
      cookies[key] = part.slice(index + 1).trim()
    }
  }
  return cookies
}

function toSessionInfo(session: SessionRecord): SessionInfo {
  return {
    user: session.user,
    memberships: session.memberships.map((membership) => ({
      collegeId: membership.collegeId,
      collegeName: membership.collegeName,
      role: membership.role as UserRole,
    })),
  }
}

function requiredText(value: unknown, label: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new HttpError(422, `${label} is required.`, { fieldErrors: { [label]: `${label} is required.` } })
  if (text.length > max) throw new HttpError(422, `${label} is too long.`)
  return text
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text) return null
  if (text.length > max) throw new HttpError(422, 'Text is too long.')
  return text
}

function optionalUser(
  db: Database,
  value: unknown,
  collegeId: string,
  roles: string[],
): string | null {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const id = String(value).trim()
  const role = db.membershipRole(id, collegeId)
  if (!role || !roles.includes(role)) {
    throw new HttpError(422, 'Choose a staff member of this college.', {
      fieldErrors: { ownerUserId: 'That account is not an eligible member of this college.' },
    })
  }
  return id
}

function describeRecord(entity: string, data: Record<string, unknown>): string {
  const candidates = [data.title, data.name, data.label, data.code, data.description, data.locationLabel]
  const label = candidates.find((value) => typeof value === 'string' && value.trim())
  return label ? `${entity} "${String(label).slice(0, 90)}"` : `${entity} ${String(data.id ?? '')}`
}

function statusWord(status: ComplaintStatus): string {
  switch (status) {
    case 'open':
      return 'open'
    case 'in_progress':
      return 'in progress'
    case 'resolved':
      return 'resolved'
    case 'closed':
      return 'closed'
    default:
      return status
  }
}

function readProvenance(db: Database): DatasetProvenance {
  const raw = db.getMeta('provenance')
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<DatasetProvenance>
      if (parsed && typeof parsed === 'object' && parsed.name) {
        return {
          name: String(parsed.name),
          synthetic: parsed.synthetic !== false,
          generatedAt: String(parsed.generatedAt ?? ''),
          generator: String(parsed.generator ?? 'MicroCity seed'),
          source: parsed.source === null || parsed.source === undefined ? null : String(parsed.source),
          license: String(parsed.license ?? 'Synthetic demonstration data'),
          notes: String(parsed.notes ?? ''),
        }
      }
    } catch {
      /* fall through to the honest fallback below */
    }
  }
  return {
    name: db.getMeta('baseDataset') ?? 'microcity-demo-2026-10',
    synthetic: true,
    generatedAt: db.getMeta('seededAt') ?? '',
    generator: 'MicroCity synthetic seed',
    source: null,
    license: 'Synthetic demonstration data',
    notes:
      'Base records are fictional demonstration data. Imported records are user-supplied; their source file, actor and time are recorded in the import history.',
  }
}

/* ------------------------------------------------------------------ */
/* Import preparation                                                 */
/* ------------------------------------------------------------------ */

const REFERENCE_FIELDS: Record<string, { field: string; parent: string; fillUnit?: boolean }[]> = {
  rooms: [{ field: 'buildingId', parent: 'buildings' }],
  timetableSlots: [{ field: 'roomId', parent: 'rooms' }],
  assets: [{ field: 'buildingId', parent: 'buildings' }],
  inspections: [{ field: 'assetId', parent: 'assets' }],
  utilityMeters: [{ field: 'buildingId', parent: 'buildings' }],
  utilityReadings: [{ field: 'meterId', parent: 'utilityMeters', fillUnit: true }],
  complaints: [
    { field: 'roomId', parent: 'rooms' },
    { field: 'assetId', parent: 'assets' },
  ],
  urbanIssues: [{ field: 'urbanAssetId', parent: 'urbanAssets' }],
}

const REFERENCE_LABELS: Record<string, string[]> = {
  buildings: ['name'],
  rooms: ['code'],
  assets: ['name'],
  utilityMeters: ['label'],
  urbanAssets: ['name', 'locationLabel'],
}

const ID_PREFIX: Record<string, string> = {
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
  urbanAssets: 'ua',
  urbanIssues: 'ui',
}

function prepareImportedRows(
  database: Database,
  prepared: Map<string, PreparedRow[]>,
  active: ActiveCollege,
  included: Set<string>,
  replace: boolean,
): void {
  for (const [entity, rows] of prepared) {
    const prefix = ID_PREFIX[entity] ?? 'rec'
    for (const row of rows) {
      const id = row.raw.id === undefined || row.raw.id === null ? '' : String(row.raw.id).trim()
      if (!id) row.raw.id = `${prefix}-imp-${randomUUID().slice(0, 10)}`
    }
  }

  const parents = new Set(
    Object.values(REFERENCE_FIELDS)
      .flat()
      .map((reference) => reference.parent),
  )
  const indexes = new Map<string, RefIndex>()
  for (const parent of parents) {
    const index: RefIndex = { ids: new Map(), labels: new Map() }
    const spec = ENTITY_BY_NAME.get(parent)
    if (!spec) continue
    const existingVisible = !(replace && included.has(parent))
    if (existingVisible) {
      const collegeId = spec.scope === 'campus' ? active.collegeId : null
      for (const record of database.listRecords(parent, collegeId)) {
        addToIndex(index, record.id, record.data, REFERENCE_LABELS[parent] ?? [])
      }
    }
    for (const row of prepared.get(parent) ?? []) {
      const id = String(row.raw.id ?? '')
      if (!id) continue
      addToIndex(index, id, row.raw, REFERENCE_LABELS[parent] ?? [])
    }
    indexes.set(parent, index)
  }

  for (const [entity, rows] of prepared) {
    const references = REFERENCE_FIELDS[entity] ?? []
    for (const row of rows) {
      for (const reference of references) {
        const rawValue = row.raw[reference.field]
        if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') continue
        const index = indexes.get(reference.parent)
        if (!index) continue
        const resolution = resolveReference(String(rawValue).trim(), index)
        if (resolution.warning) row.warnings.push(resolution.warning)
        if (resolution.id !== String(rawValue).trim()) row.raw[reference.field] = resolution.id
      }
      if (entity === 'utilityReadings' && !optionalRaw(row.raw.unit)) {
        const meterId = optionalRaw(row.raw.meterId)
        if (meterId) {
          const meter = database.getRecord(meterId)
          const unit = meter?.entity === 'utilityMeters' ? optionalRaw(meter.data.unit) : incomingUnit(prepared, meterId)
          if (unit) {
            row.raw.unit = unit
            row.warnings.push(`Unit copied from the selected meter (${unit}).`)
          }
        }
      }
    }
  }
}

function addToIndex(
  index: RefIndex,
  id: string,
  data: Record<string, unknown>,
  labelFields: string[],
): void {
  index.ids.set(id.toLowerCase(), id)
  for (const field of labelFields) {
    const label = optionalRaw(data[field])
    if (!label) continue
    const key = label.toLowerCase()
    const bucket = index.labels.get(key) ?? new Set<string>()
    bucket.add(id)
    index.labels.set(key, bucket)
  }
}

function resolveReference(value: string, index: RefIndex): { id: string; warning: string | null } {
  const exact = index.ids.get(value.toLowerCase())
  if (exact) return { id: exact, warning: null }
  const matches = [...(index.labels.get(value.toLowerCase()) ?? [])]
  if (matches.length === 1) {
    return { id: matches[0], warning: `Resolved reference "${value}" to ${matches[0]}.` }
  }
  if (matches.length > 1) {
    return {
      id: value,
      warning: `Reference "${value}" is ambiguous (${matches.length} matches); use the record ID instead.`,
    }
  }
  return { id: value, warning: null }
}

function incomingUnit(prepared: Map<string, PreparedRow[]>, meterId: string): string | null {
  for (const row of prepared.get('utilityMeters') ?? []) {
    if (String(row.raw.id ?? '') !== meterId) continue
    return optionalRaw(row.raw.unit)
  }
  return null
}

function optionalRaw(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text ? text : null
}

function pushRow(
  outcome: ImportEntityOutcome,
  row: PreparedRow,
  status: ImportRowOutcome['status'],
  id: string | null,
  message: string | null,
  errors: Record<string, string>,
  extraWarnings: string[] = [],
): void {
  outcome.rows.push({
    rowNumber: row.rowNumber,
    status,
    id,
    message,
    errors,
    warnings: [...row.warnings, ...extraWarnings],
  })
  if (status === 'imported') outcome.imported += 1
  else if (status === 'skipped') outcome.skipped += 1
  else outcome.rejected += 1
}

function dataWarnings(entity: string, data: Record<string, unknown>): string[] {
  const warnings: string[] = []
  if (entity === 'rooms' && data.capacity === null) {
    warnings.push('Seat capacity is missing; capacity findings will say unavailable rather than zero.')
  }
  if (entity === 'timetableSlots' && data.expectedAttendance === null) {
    warnings.push('Expected attendance is missing; demand cannot be assessed for this booking.')
  }
  if (entity === 'utilityReadings' && data.value === null) {
    warnings.push('Reading value is missing; it is preserved as a gap, not treated as zero usage.')
  }
  if (
    entity === 'complaints' &&
    (data.status === 'resolved' || data.status === 'closed') &&
    !data.resolvedAt
  ) {
    warnings.push('Status is resolved or closed but no resolution date is recorded.')
  }
  if (entity === 'inspections' && data.status === 'completed' && !data.completedAt) {
    warnings.push('Inspection is completed but no completion time is recorded.')
  }
  if (
    entity === 'urbanIssues' &&
    (data.status === 'resolved' || data.status === 'closed') &&
    !data.resolvedAt
  ) {
    warnings.push('Public issue is resolved or closed but no resolution date is recorded.')
  }
  if (entity === 'assets' && data.condition === null) {
    warnings.push('Condition is not recorded; condition-based maintenance scoring will be unavailable.')
  }
  return warnings
}
