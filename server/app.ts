/**
 * MicroCity HTTP API.
 *
 * Authentication, college isolation and authorisation are enforced here, on
 * the server. The browser never receives records from a college the signed-in
 * account does not belong to, and all record writes pass through the
 * server-authoritative validators in record-validation.ts.
 */
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CAMPUS_ENTITIES, ENTITY_BY_NAME, IMPORT_ORDER } from '../src/domain/entities.ts'
import { ALL_ROLES, capabilityMatrix, hasCapability } from '../src/domain/permissions.ts'
import { analyseWorkspace } from '../src/domain/analysis/index.ts'
import type { MeterAnalysis } from '../src/domain/analysis/index.ts'
import { COMPLAINT_CATEGORIES } from '../src/domain/types.ts'
import { titleCase } from '../src/lib/format.ts'
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
import { ATTENDANCE_REASONS, INSPECTION_RESULTS, DEFAULT_PRIORITY_WEIGHTS } from '../src/domain/types.ts'
import { istDateKey } from '../src/lib/time.ts'
import { buildReportFacts, weakestTag } from '../src/lib/reports.ts'
import type { FigureTag } from '../src/lib/reports.ts'
import { loadAiSettings, runAiTask, type AiTask } from './ai.ts'
import { guardAiNumbers } from './number-guard.ts'
import {
  parseNeedsLimit,
  parsePriorityWeightsInput,
  readNeedsLimits,
  readPriorityWeights,
  saveNeedsLimit,
  savePriorityWeights,
} from './config.ts'
import type { Database, StoredRecord, StoredUser } from './db.ts'
import { hashPassword, verifyPassword } from './passwords.ts'
import { SAMPLE_ACCOUNTS } from './seed.ts'
import { TIWARI_ACCOUNTS, TIWARI_COLLEGE_NAME, ensureTiwariWorkspace } from './tiwari.ts'
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
  mode: 'demo' | 'pilot'
  code: string | null
  address: string | null
  email: string | null
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
  // Idempotent: completes any Tiwari bootstrap step that was waiting for data.
  ensureTiwariWorkspace(db)
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
    const college = db.getCollege(membership.collegeId)
    return {
      collegeId: membership.collegeId,
      collegeName: membership.collegeName,
      role,
      mode: college?.mode ?? 'demo',
      code: college?.code ?? null,
      address: college?.address ?? null,
      email: college?.email ?? null,
    }
  }

  function requirePlatformAdmin(req: IncomingMessage): SessionRecord {
    const session = requireSession(req)
    if (!session.user.platformAdmin) {
      throw new HttpError(403, 'Only a Platform admin can manage colleges.', { code: 'platform-admin-required' })
    }
    return session
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

  function issueOriginCollege(data: Record<string, unknown>): string | null {
    const stored = typeof data.reporterCollegeId === 'string' ? data.reporterCollegeId : ''
    if (stored) return stored
    const reporterId = typeof data.reporterId === 'string' ? data.reporterId : ''
    const memberships = reporterId ? db.getMemberships(reporterId) : []
    return memberships.length === 1 ? memberships[0].collegeId : null
  }

  function publicIssueForCollege(data: Record<string, unknown>, collegeId: string): UrbanIssue {
    const item = data as unknown as UrbanIssue
    const sameCollege = issueOriginCollege(data) === collegeId
    return {
      id: item.id, urbanAssetId: item.urbanAssetId,
      reporterId: sameCollege ? item.reporterId : null,
      reporterName: sameCollege && item.reporterId ? db.getUser(item.reporterId)?.displayName : undefined,
      category: item.category, severity: item.severity, description: item.description,
      locationLabel: item.locationLabel, authority: item.authority, reportedAt: item.reportedAt,
      status: item.status, resolvedAt: item.resolvedAt, note: item.note ?? null,
      photoName: item.photoName, photoDataUrl: item.photoDataUrl,
    }
  }

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
    // Photos are only served by the authorised photo endpoint. Lists carry the
    // presence flags, never the base64 bytes, for every role.
    const enrichedComplaints = complaints.map((item) => ({
      ...item,
      reporterName: nameOf(item.reporterId) ?? 'Unknown reporter',
      assignedToName: nameOf(item.assignedToUserId),
      hasPhoto: Boolean(item.photoDataUrl),
      hasCompletionPhoto: Boolean(item.completionPhotoDataUrl),
      photoDataUrl: undefined,
      completionPhotoDataUrl: undefined,
    }))

    const visibleUpdates = campus('complaintUpdates').filter((record) =>
      visibleComplaintIds.has(String(record.data.complaintId ?? '')),
    )

    // Unassigned inspections belong to the whole college's maintenance team;
    // once an inspector is recorded only that person keeps working on it.
    const inspections =
      role === 'maintenance'
        ? campus('inspections').filter((record) => {
            const inspector = String(record.data.inspectorUserId ?? '')
            return inspector === '' || inspector === session.user.id
          })
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

    // Public issues are college-scoped for viewing (Phase G): an issue is
    // visible only inside the college whose account reported it. Other
    // colleges see none of it — description, photo, note or reporter.
    const urbanIssues = canSeePublic
      ? publicRecords('urbanIssues')
          .filter((record) => issueOriginCollege(record.data) === active.collegeId)
          .map((record) => publicIssueForCollege(record.data, active.collegeId))
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
      nearbyAssets: dataOf(campus('nearbyAssets')),
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
      activeCollege: {
        id: active.collegeId,
        name: active.collegeName,
        role,
        mode: active.mode,
        code: active.code,
        address: active.address,
        email: active.email,
      },
      memberships: session.memberships.map((membership) => ({
        collegeId: membership.collegeId,
        collegeName: membership.collegeName,
        role: membership.role as UserRole,
      })),
      provenance:
        active.mode === 'pilot'
          ? {
              name: 'tiwari-illustrative-2026-11',
              synthetic: false,
              generatedAt: '2026-11-15T00:00:00Z',
              generator:
                'Imported from Tiwari_College_illustrative_data_v2.xlsx plus seeded illustrative workspace records; no AI',
              source: 'Pilot workbook supplied for the college',
              license: 'Illustrative pilot data - not a survey of the real college',
              notes:
                'Every campus record is illustrative. The college name and address are real location details. The two bus stops are public-source records (Estimated) and their condition, daily users and authority are not recorded. Tariffs and option costs are deliberately blank.',
            }
          : readProvenance(db),
      dataset: sources,
      imports,
      audit,
      members,
      needsLimits: full ? readNeedsLimits(db, active.collegeId) : [],
      // Every role that ranks work receives the same administrator-set weights,
      // so the order a person sees matches the audited configuration.
      priorityWeights: readPriorityWeights(db, active.collegeId) ?? { ...DEFAULT_PRIORITY_WEIGHTS },
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
    // Public issues are scoped to their origin college for every operation,
    // including updates: another college's issue simply does not exist here.
    if (entity === 'urbanIssues' && issueOriginCollege(record.data) !== active.collegeId) {
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
    sendJson(res, 201, { record: entity === 'urbanIssues' ? publicIssueForCollege(data, active.collegeId) : data })
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

    const transition = result.meta.statusChange
    writeAudit(
      active,
      actor,
      'update',
      entity,
      existing.id,
      transition
        ? `Changed ${entity === 'complaints' ? 'complaint' : entity} status from ${transition.from} to ${transition.to}.`
        : `Updated ${describeRecord(entity, result.record)}.`,
      {
        fields: Object.keys(body.data).filter((key) => key !== 'photoDataUrl'),
        ...(transition ? { fromStatus: transition.from, toStatus: transition.to } : {}),
      },
    )
    sendJson(res, 200, { record: entity === 'urbanIssues' ? publicIssueForCollege(result.record, active.collegeId) : result.record, meta: result.meta })
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
    const scope = db
      .listRecords('complaints', active.collegeId)
      .map((record) => record.data as unknown as Complaint)
    return buildJobCards([complaint], rooms, buildings, assets, asOf, scope)[0]
  }

  function maintenanceJobCards(active: ActiveCollege, actor: Actor, asOf: string): JobCard[] {
    // The analysis scope is every complaint in the college so repeat counts and
    // priority points match the staff view; only this technician's jobs become
    // cards, so colleagues' report details never reach this response.
    const collegeComplaints = db
      .listRecords('complaints', active.collegeId)
      .map((record) => record.data as unknown as Complaint)
    const mine = collegeComplaints.filter(
      (complaint) => String(complaint.assignedToUserId ?? '') === actor.id,
    )
    return buildJobCards(
      mine,
      dataOfList<Room>(db.listRecords('rooms', active.collegeId)),
      dataOfList<Building>(db.listRecords('buildings', active.collegeId)),
      dataOfList<Asset>(db.listRecords('assets', active.collegeId)),
      asOf,
      collegeComplaints,
    )
  }

  function maintenanceInspections(active: ActiveCollege, actor: Actor, asOf: string): InspectionCard[] {
    const inspections = db
      .listRecords('inspections', active.collegeId)
      .filter((record) => {
        const inspector = String(record.data.inspectorUserId ?? '')
        return inspector === '' || inspector === actor.id
      })
      .map((record) => record.data as unknown as Inspection)
    return buildInspectionCards(
      inspections,
      dataOfList<Asset>(db.listRecords('assets', active.collegeId)),
      asOf,
      (userId) => (userId ? db.getUser(userId)?.displayName ?? null : null),
    )
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

  /**
   * Complaint photos are only served through this endpoint. It re-checks the
   * college, the role and ownership before reading the stored data URL, so a
   * URL alone never grants access to another student's or college's photo.
   */
  async function handleComplaintPhoto(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
    url: URL,
  ): Promise<void> {
    const session = requireSession(req)
    const active = requireActive(req, url, session)
    const actor = actorFrom(session, active)
    const record = id ? db.getRecord(id) : undefined
    if (!record || record.entity !== 'complaints' || record.collegeId !== active.collegeId) {
      throw new HttpError(404, 'That report is not in this college.')
    }
    const complaint = record.data as unknown as Complaint
    const allowed =
      active.role === 'admin' ||
      active.role === 'estates' ||
      (active.role === 'maintenance' && String(complaint.assignedToUserId ?? '') === actor.id) ||
      String(complaint.reporterId ?? '') === actor.id
    if (!allowed) {
      throw new HttpError(403, 'You cannot view a photo on this report.')
    }

    const kind = url.searchParams.get('kind') === 'completion' ? 'completion' : 'report'
    const dataUrl = kind === 'completion' ? complaint.completionPhotoDataUrl : complaint.photoDataUrl
    const match = typeof dataUrl === 'string' ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null
    if (!match) {
      throw new HttpError(404, kind === 'completion' ? 'No after photo is recorded.' : 'No report photo is recorded.')
    }
    const bytes = Buffer.from(match[2], 'base64')
    res.writeHead(200, {
      'Content-Type': match[1],
      'Content-Length': bytes.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="${kind === 'completion' ? 'after-photo' : 'report-photo'}"`,
    })
    res.end(bytes)
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
  /* Per-college configuration (administrator only)                 */
  /* -------------------------------------------------------------- */

  async function handleNeedsLimit(
    req: IncomingMessage,
    res: ServerResponse,
    category: string,
  ): Promise<void> {
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    const actor = actorFrom(session, active)
    if (!hasCapability(active.role, 'manage-thresholds')) {
      throw new HttpError(403, 'Only an administrator can set a limit or its source.')
    }
    const body = await readJson(req)
    const parsed = parseNeedsLimit(category, body)
    if (!parsed.ok) throw new HttpError(422, parsed.error)
    const previous = readNeedsLimits(db, active.collegeId).find((entry) => entry.category === category) ?? null
    const config = {
      category,
      ...parsed.value,
      updatedAt: new Date().toISOString(),
      updatedByName: actor.displayName,
    }
    saveNeedsLimit(db, active.collegeId, config)
    writeAudit(
      active,
      actor,
      'threshold',
      'needsLimit',
      category,
      `Set the ${category} limit to ${config.limit} ${config.unit} (${config.kind === 'published_norm' ? 'Published norm' : 'Project assumption'}). Source: ${config.source}.`,
      { old: previous, new: config },
    )
    sendJson(res, 200, { config, needsLimits: readNeedsLimits(db, active.collegeId) })
  }

  async function handlePriorityWeights(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    const actor = actorFrom(session, active)
    if (!hasCapability(active.role, 'manage-priority-weights')) {
      throw new HttpError(403, 'Only an administrator can change the priority weights.')
    }
    const body = await readJson(req)
    const parsed = parsePriorityWeightsInput(body)
    if (!parsed.ok) throw new HttpError(422, parsed.error)
    const previous = readPriorityWeights(db, active.collegeId)
    const weights = {
      ...parsed.value,
      updatedAt: new Date().toISOString(),
      updatedByName: actor.displayName,
    }
    savePriorityWeights(db, active.collegeId, weights)
    writeAudit(
      active,
      actor,
      'weights',
      'priorityWeights',
      null,
      `Changed maintenance priority weights: severity ${previous.severity} to ${weights.severity}, condition ${previous.condition} to ${weights.condition}, users affected ${previous.usersAffected} to ${weights.usersAffected}, days open ${previous.daysOpen} to ${weights.daysOpen}.`,
      { old: previous, new: weights },
    )
    sendJson(res, 200, { weights })
  }

  function requireAdminRead(req: IncomingMessage): { active: ActiveCollege } {
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    if (!hasCapability(active.role, 'manage-users')) {
      throw new HttpError(403, 'This administrator view is available to administrators only.')
    }
    return { active }
  }

  function handleAdminAudit(req: IncomingMessage, res: ServerResponse): void {
    const { active } = requireAdminRead(req)
    sendJson(res, 200, {
      audit: db.listAudit(active.collegeId, 120).map((row) => ({
        id: row.id,
        at: row.at,
        actorName: row.actorName,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        detail: row.detail,
        metadata: row.metadata,
      })),
    })
  }

  function handleAdminAiSettings(req: IncomingMessage, res: ServerResponse): void {
    requireAdminRead(req)
    const stats = db.aiCallsToday()
    sendJson(res, 200, {
      configured: Boolean(aiSettings),
      model: aiSettings?.model ?? null,
      callsToday: stats.calls,
      rejectedToday: stats.rejected,
      dataNote: 'Text you type in a report and the facts behind a finding are sent to the AI provider.',
    })
  }

  function handleAdminRoleMatrix(req: IncomingMessage, res: ServerResponse): void {
    requireAdminRead(req)
    sendJson(res, 200, { capabilities: capabilityMatrix() })
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
      throw new HttpError(403, 'Only an administrator can import data.')
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
      // The Tiwari bootstrap waits for the imported buildings before it can
      // create meters and the illustrative world; this is idempotent.
      ensureTiwariWorkspace(database)
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
    if (chosenRoleRaw && chosenRoleRaw !== 'platform_admin' && !asRole(chosenRoleRaw)) {
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
    if (memberships.length === 0 && !user.platformAdmin) {
      throw new HttpError(403, 'This account has no college membership. Ask an administrator to add you.')
    }
    if (user.platformAdmin) {
      if (chosenCollegeId || (chosenRole && chosenRole !== 'platform_admin')) {
        throw new HttpError(403, 'A Platform admin account does not belong to a college.', {
          code: 'platform-admin-no-college',
        })
      }
    } else {
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
    }

    loginAttempts.delete(key)
    const token = db.createSession(user.id, SESSION_TTL_MS)
    setSessionCookie(res, token)
    const session: SessionRecord = {
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        sample: user.sample,
        platformAdmin: user.platformAdmin,
      },
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
    const colleges = new Map(db.listColleges().map((college) => [college.id, college]))
    const tiwariCollege = [...colleges.values()].find((college) => college.name === TIWARI_COLLEGE_NAME)
    const tiwariAvailable = tiwariCollege
      ? TIWARI_ACCOUNTS.filter((account) => db.getUserByUsername(account.username)).map((account) => ({
          ...account,
          collegeId: tiwariCollege.id,
        }))
      : []
    const available = [
      ...SAMPLE_ACCOUNTS.filter((account) => colleges.has(account.collegeId) && db.getUserByUsername(account.username)),
      ...tiwariAvailable,
    ]
    const accounts: {
      role: UserRole
      username: string
      password: string
      collegeId: string
      collegeName: string
    }[] = available.map((account) => ({
      role: account.role as UserRole,
      username: account.username,
      password: account.password,
      collegeId: account.collegeId,
      collegeName: colleges.get(account.collegeId)?.name ?? account.collegeId,
    }))
    const platform = db.getUserByUsername('platform-admin')
    if (platform) {
      accounts.push({
        role: 'platform_admin' as UserRole,
        username: platform.username,
        password: 'platform-admin-demo-pass',
        collegeId: '',
        collegeName: 'Platform (no college)',
      })
    }
    sendJson(res, 200, { enabled: true, accounts })
  }

  function handlePlatformColleges(req: IncomingMessage, res: ServerResponse): void {
    requirePlatformAdmin(req)
    const colleges = db.listColleges().map((college) => ({
      id: college.id,
      name: college.name,
      code: college.code,
      address: college.address,
      email: college.email,
      mode: college.mode,
      members: db.listCollegeMembers(college.id).length,
    }))
    sendJson(res, 200, { colleges })
  }

  function collegeCodeFor(name: string): string {
    const letters = name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'COLLEGE'
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const suffix = String(1000 + (randomBytes(2).readUInt16BE(0) % 9000))
      const code = `${letters}-${suffix}`
      if (!db.findCollegeByCode(code)) return code
    }
    throw new HttpError(500, 'Could not generate a unique college code. Try again.')
  }

  async function handlePlatformCollegeCreate(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = requirePlatformAdmin(req)
    const body = await readJson(req)
    const name = requiredText(body.name, 'College name', 160)
    const address = requiredText(body.address, 'Address', 240)
    const email = requiredText(body.email, 'Official email', 160)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(422, 'Enter a valid official email address.', {
        fieldErrors: { 'Official email': 'Enter a valid official email address.' },
      })
    }
    const code = collegeCodeFor(name)
    const collegeId = `clg-${randomUUID()}`
    const adminId = `usr-${randomUUID()}`
    const username = `admin-${randomBytes(3).toString('hex')}`
    const temporaryPassword = randomBytes(9).toString('base64url')

    db.sql.exec('BEGIN IMMEDIATE')
    try {
      db.createCollege({ id: collegeId, name, code, address, email, mode: 'pilot' })
      db.createAccount({
        id: adminId,
        username,
        displayName: `${name} Administrator`,
        password: temporaryPassword,
        collegeId,
        role: 'admin',
        sample: false,
      })
      db.sql.exec('COMMIT')
    } catch (error) {
      try {
        db.sql.exec('ROLLBACK')
      } catch {
        /* the transaction is already closed */
      }
      throw error
    }

    db.addAudit({
      collegeId: null,
      actorId: session.user.id,
      actorName: session.user.displayName,
      action: 'create-college',
      entity: 'colleges',
      entityId: collegeId,
      detail: `Created the college "${name}" (${code}) and its first administrator.`,
      metadata: null,
    })
    ensureTiwariWorkspace(db)

    sendJson(res, 201, {
      college: { id: collegeId, name, code, address, email, mode: 'pilot' },
      admin: { username, temporaryPassword },
      notice:
        'Show this temporary password once. The administrator can share the college code with students and faculty, and create Estates and Maintenance accounts.',
    })
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
      user: { id, username, displayName, sample: false, platformAdmin: false },
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
        user: { id, username, displayName, sample: false, platformAdmin: false },
        memberships: db.getMemberships(id),
      }),
    })
  }

  /* -------------------------------------------------------------- */
  /* AI proxy (Phase G)                                             */
  /*                                                                */
  /* One server function (`runAiTask`) talks to the provider. Calls  */
  /* are rate-limited per user, identical requests are cached for   */
  /* ten minutes, every provider attempt is logged without prompt   */
  /* text or response bodies, and user-typed text is delimited and  */
  /* marked as data. Text answers pass a number guard before they   */
  /* are shown; a rejected answer is never stored.                  */
  /* -------------------------------------------------------------- */

  const AI_CACHE_TTL_MS = 10 * 60 * 1000
  const aiCache = new Map<string, { at: number; payload: Record<string, unknown> }>()

  function aiCacheKey(
    task: AiTask,
    collegeId: string,
    facts: unknown,
    question: string | null,
  ): string {
    return createHash('sha256')
      .update(`${task}\u0000${collegeId}\u0000${JSON.stringify(facts)}\u0000${question ?? ''}`)
      .digest('hex')
  }

  function aiCacheGet(key: string): Record<string, unknown> | null {
    const hit = aiCache.get(key)
    if (!hit) return null
    if (Date.now() - hit.at > AI_CACHE_TTL_MS) {
      aiCache.delete(key)
      return null
    }
    return hit.payload
  }

  function aiCachePut(key: string, payload: Record<string, unknown>): void {
    if (aiCache.size > 500) {
      for (const [staleKey, entry] of aiCache) {
        if (Date.now() - entry.at > AI_CACHE_TTL_MS) aiCache.delete(staleKey)
      }
    }
    aiCache.set(key, { at: Date.now(), payload })
  }

  function logAiCall(
    userId: string,
    feature: string,
    refId: string | null,
    accepted: boolean,
    reason: string,
  ): void {
    db.addAiCall({ userId, feature, refId, accepted, reason })
  }

  function extractJson(text: string | null): Record<string, unknown> | null {
    if (!text) return null
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1))
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  async function runGuardedTextTask(
    session: SessionRecord,
    active: ActiveCollege,
    args: {
      task: 'explain-finding' | 'report-summary' | 'option-comparison'
      facts: Record<string, unknown>
      refId: string | null
      question?: string
      /** Exact line count the answer must have (report summary: five). */
      requireLines?: number
    },
  ): Promise<Record<string, unknown>> {
    const cacheKey = aiCacheKey(args.task, active.collegeId, args.facts, args.question ?? null)
    const cached = aiCacheGet(cacheKey)
    if (cached) {
      logAiCall(
        session.user.id,
        args.task,
        args.refId,
        cached.accepted === true,
        cached.accepted === true ? 'cache_hit' : String(cached.reason ?? 'cache_hit_rejected'),
      )
      return cached
    }

    const answer = await runAiTask(aiSettings!, args.task, args.facts, { question: args.question })
    if (!answer.ok) {
      logAiCall(session.user.id, args.task, args.refId, false, 'provider_error')
      return {
        ok: false,
        configured: true,
        accepted: false,
        error: answer.error,
        text: null,
        model: answer.model,
        label: 'Rule-based explanation',
      }
    }
    const guard = guardAiNumbers(answer.text ?? '', args.facts)
    if (!guard.ok) {
      logAiCall(session.user.id, args.task, args.refId, false, 'unsupported_number')
      db.addAudit({
        collegeId: active.collegeId,
        actorId: session.user.id,
        actorName: 'AI guard',
        action: 'ai_rejected',
        entity: 'ai',
        entityId: args.refId,
        detail: 'AI answer rejected: unsupported number',
        metadata: null,
      })
      const payload = {
        ok: true,
        configured: true,
        accepted: false,
        text: null,
        reason: 'unsupported_number',
        label: 'Rule-based explanation',
        model: answer.model,
        checkedAt: new Date().toISOString(),
      }
      aiCachePut(cacheKey, payload)
      return payload
    }
    if (args.requireLines) {
      const lineCount = (answer.text ?? '').split('\n').filter((line) => line.trim()).length
      if (lineCount !== args.requireLines) {
        logAiCall(session.user.id, args.task, args.refId, false, 'not_five_lines')
        const payload = {
          ok: true,
          configured: true,
          accepted: false,
          text: null,
          reason: 'not_five_lines',
          label: 'Rule-based explanation',
          model: answer.model,
          checkedAt: new Date().toISOString(),
        }
        aiCachePut(cacheKey, payload)
        return payload
      }
    }
    logAiCall(session.user.id, args.task, args.refId, true, 'accepted')
    const payload = {
      ok: true,
      configured: true,
      accepted: true,
      text: answer.text,
      model: answer.model,
      label: 'AI-generated, please verify',
      checkedAt: new Date().toISOString(),
    }
    aiCachePut(cacheKey, payload)
    return payload
    aiCachePut(cacheKey, payload)
    return payload
  }

  const AI_LOOKUPS: { id: string; question: string }[] = [
    { id: 'rooms-over-capacity', question: 'Which rooms have demand above their seat capacity?' },
    { id: 'meters-with-spikes', question: 'Which meters have flagged consumption spikes?' },
    { id: 'open-critical-issues', question: 'Which critical issues are still open?' },
    { id: 'nearby-critical', question: 'Which nearby public infrastructure types are in Critical status?' },
    { id: 'decisions-waiting', question: 'Which plan options are waiting for a decision?' },
  ]

  function meterFigureTagFor(meter: MeterAnalysis): FigureTag {
    if (meter.knownPeriods === 0) return 'Missing'
    return meter.measurementType === 'estimated' ? 'Estimated' : 'Measured'
  }

  /**
   * The server — never the model — computes the lookup result from stored
   * records. The AI only maps the question to one fixed lookup id.
   */
  function runDataLookup(
    session: SessionRecord,
    active: ActiveCollege,
    lookupId: string,
  ): { title: string; items: { label: string; detail: string; tag: FigureTag }[]; note: string } {
    const payload = buildWorkspace(session, active)
    const analysis = analyseWorkspace(payload.dataset, payload.serverTime, payload.priorityWeights)
    const items: { label: string; detail: string; tag: FigureTag }[] = []
    let title = 'Data lookup'
    let note = ''

    if (lookupId === 'rooms-over-capacity') {
      title = 'Rooms over capacity'
      note = 'Peak enrolled is the largest expected class booked in the room; capacity is recorded seats.'
      for (const room of analysis.capacity.rooms) {
        if (room.expectedPeak === null || room.capacity === null || room.expectedPeak <= room.capacity) continue
        items.push({
          label: `Room ${room.code}`,
          detail: `Peak enrolled ${room.expectedPeak} against ${room.capacity} seats (${room.expectedPeak - room.capacity} over).`,
          tag: 'Measured',
        })
      }
    } else if (lookupId === 'meters-with-spikes') {
      title = 'Meters with flagged spikes'
      note = 'Spikes are statistical prompts from recorded readings; the cause is unknown.'
      for (const meter of analysis.utilities.meters) {
        for (const spike of meter.spikes) {
          items.push({
            label: meter.meter.label,
            detail: `${spike.consumption} ${meter.meter.unit} on ${spike.at.slice(0, 10)}, ${Math.round(spike.deviationPct * 100)}% above the comparison baseline.`,
            tag: meterFigureTagFor(meter),
          })
        }
      }
    } else if (lookupId === 'open-critical-issues') {
      title = 'Open critical issues'
      note = 'Campus complaints with severity Critical still Open or In progress.'
      for (const complaint of payload.dataset.complaints) {
        if (complaint.severity !== 'critical') continue
        if (complaint.status !== 'open' && complaint.status !== 'in_progress') continue
        items.push({
          label: complaint.ticketNumber ?? complaint.id,
          detail: `${complaint.category}: ${complaint.description.slice(0, 140)}`,
          tag: 'Measured',
        })
      }
    } else if (lookupId === 'nearby-critical') {
      title = 'Nearby types in Critical status'
      note = 'Status comes from recorded conditions; daily users never decide status.'
      for (const row of analysis.nearby) {
        if (row.status !== 'critical') continue
        items.push({
          label: row.label,
          detail: `${row.poor} of ${row.recorded} recorded conditions are Poor.`,
          tag: weakestTag(row.records.map((asset) => titleCase(asset.basis) as FigureTag)),
        })
      }
    } else if (lookupId === 'decisions-waiting') {
      title = 'Plan options waiting for a decision'
      note = 'Options with no decision yet, plus proposals awaiting an administrator decision.'
      for (const option of analysis.plan.options) {
        if (option.approvalState !== 'none' && option.approvalState !== 'proposed') continue
        items.push({
          label: option.title,
          detail:
            option.approvalState === 'proposed'
              ? 'Proposed — awaiting administrator decision.'
              : 'No decision recorded yet.',
          tag: 'Illustrative',
        })
      }
    } else {
      throw new HttpError(422, 'Unknown lookup.')
    }
    return { title, items, note }
  }

  function roomsForSuggestion(active: ActiveCollege): {
    id: string
    code: string
    name: string | null
    building: string | null
  }[] {
    const buildingNames = new Map(
      db.listRecords('buildings', active.collegeId).map((record) => [
        String(record.id),
        String(record.data.name ?? 'Building'),
      ]),
    )
    return db.listRecords('rooms', active.collegeId).map((record) => ({
      id: String(record.id),
      code: String(record.data.code ?? ''),
      name: typeof record.data.name === 'string' ? record.data.name : null,
      building: buildingNames.get(String(record.data.buildingId ?? '')) ?? null,
    }))
  }

  function validatedSuggestion(
    parsed: Record<string, unknown>,
    rooms: { id: string; code: string; name: string | null; building: string | null }[],
  ): { category: string; roomId: string | null; roomLabel: string | null; severity: string | null } | null {
    const categoryRaw = typeof parsed.category === 'string' ? parsed.category.trim() : ''
    const category = COMPLAINT_CATEGORIES.find((item) => item.toLowerCase() === categoryRaw.toLowerCase())
    // An off-list category is discarded entirely; the user gets no suggestion.
    if (!category) return null
    const roomRaw = typeof parsed.room === 'string' ? parsed.room.trim() : ''
    const room = roomRaw
      ? rooms.find((item) => item.id.toLowerCase() === roomRaw.toLowerCase()) ??
        rooms.find((item) => item.code.toLowerCase() === roomRaw.toLowerCase()) ??
        null
      : null
    const severityRaw = typeof parsed.severity === 'string' ? parsed.severity.trim().toLowerCase() : ''
    const severity = ['low', 'medium', 'high', 'critical'].includes(severityRaw) ? severityRaw : null
    return {
      category,
      roomId: room?.id ?? null,
      roomLabel: room
        ? `${room.code} — ${room.name ?? 'room'} · ${room.building ?? 'building'}`
        : null,
      severity,
    }
  }

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
      // A platform operator has no campus workspace; no AI task is available.
      platform_admin: [],
    }
    if (!allowedTasks[active.role].includes(task)) {
      throw new HttpError(403, 'Your role cannot use this AI task.')
    }
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
    bumpLimit(aiUsage, session.user.id, 15, 60_000, 'The assistant has been used frequently.')

    if (task === 'explain-finding') {
      const finding = isRecord(body.finding) ? body.finding : null
      if (!finding) throw new HttpError(400, 'Send the finding to explain in "finding".')
      const workspace = buildWorkspace(session, active)
      const analysis = analyseWorkspace(workspace.dataset, workspace.serverTime, workspace.priorityWeights)
      const requestedId = typeof finding.id === 'string' ? finding.id.slice(0, 120) : ''
      const computed = analysis.findings.find((item) => item.id === requestedId)
      if (!computed) throw new HttpError(404, 'That finding is not in the current college analysis.')
      // Only a finding recomputed from this college's stored records is sent.
      // Its evidence carries the recorded values, units, rule and threshold
      // context; the client cannot add numbers to the facts the guard trusts.
      const findingFacts = {
        findingId: computed.id,
        module: computed.module,
        severity: computed.severity,
        title: computed.title,
        summary: computed.summary,
        ruleName: `${computed.module} deterministic analysis`,
        thresholdType:
          typeof computed.facts.thresholdType === 'string'
            ? computed.facts.thresholdType
            : 'existing deterministic rule',
        thresholdSource:
          typeof computed.facts.thresholdSource === 'string'
            ? computed.facts.thresholdSource
            : 'MicroCity analysis of this college’s recorded data',
        evidence: computed.evidence,
        limitations: computed.limitations,
        facts: computed.facts,
      }
      const payload = await runGuardedTextTask(session, active, {
        task: 'explain-finding',
        facts: findingFacts,
        refId: computed.id,
      })
      sendJson(res, payload.ok === false ? 502 : 200, payload)
      return
    }

    if (task === 'report-summary') {
      const workspace = buildWorkspace(session, active)
      const analysis = analyseWorkspace(workspace.dataset, workspace.serverTime, workspace.priorityWeights)
      const facts = buildReportFacts({
        workspace,
        analysis,
        preparedBy: session.user.displayName,
        roleLabel: active.role,
      })
      const payload = await runGuardedTextTask(session, active, {
        task: 'report-summary',
        facts,
        refId: 'report-summary',
        requireLines: 5,
      })
      sendJson(res, payload.ok === false ? 502 : 200, payload)
      return
    }

    if (task === 'option-comparison') {
      const workspace = buildWorkspace(session, active)
      const analysis = analyseWorkspace(workspace.dataset, workspace.serverTime, workspace.priorityWeights)
      const facts = {
        options: analysis.plan.options.map((option) => ({
          title: option.title,
          type: option.optionType,
          capitalCost: option.capitalCost,
          annualCost: option.annualCost,
          annualSavings: option.annualSavings,
          netAnnualBenefit: option.netAnnualBenefit,
          simplePaybackMonths: option.simplePaybackMonths,
          seatEffect: option.seatEffect,
          disruptionDays: option.disruptionDays,
          implementationWeeks: option.implementationWeeks,
          approvalState: option.approvalState,
        })),
      }
      const payload = await runGuardedTextTask(session, active, {
        task: 'option-comparison',
        facts,
        refId: 'option-comparison',
      })
      sendJson(res, payload.ok === false ? 502 : 200, payload)
      return
    }

    if (task === 'categorise-issue') {
      const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4_000) : ''
      if (!text) throw new HttpError(422, 'Type what is wrong before asking for a suggestion.')
      const rooms = roomsForSuggestion(active)
      // Only the typed text and the allowed lists are sent. The typed text is
      // delimited and marked as data, so an instruction inside it is not a
      // prompt: the reply can only fill the validated suggested fields.
      const facts = {
        categories: [...COMPLAINT_CATEGORIES],
        severities: ['low', 'medium', 'high', 'critical'],
        rooms,
      }
      const cacheKey = aiCacheKey(task, active.collegeId, { facts, text }, null)
      const cached = aiCacheGet(cacheKey)
      if (cached) {
        logAiCall(
          session.user.id,
          task,
          'categorise-issue',
          cached.accepted === true,
          cached.accepted === true ? 'cache_hit' : String(cached.reason ?? 'cache_hit_rejected'),
        )
        sendJson(res, 200, cached)
        return
      }
      const answer = await runAiTask(aiSettings, 'categorise-issue', facts, { userData: text })
      if (!answer.ok) {
        logAiCall(session.user.id, task, 'categorise-issue', false, 'provider_error')
        sendJson(res, 502, {
          ok: false,
          configured: true,
          error: answer.error,
          text: null,
          model: answer.model,
        })
        return
      }
      const parsed = extractJson(answer.text)
      if (!parsed) {
        logAiCall(session.user.id, task, 'categorise-issue', false, 'malformed_json')
        const payload = {
          ok: true,
          configured: true,
          accepted: false,
          suggestion: null,
          reason: 'malformed_json',
          label: 'Rule-based explanation',
        }
        aiCachePut(cacheKey, payload)
        sendJson(res, 200, payload)
        return
      }
      const suggestion = validatedSuggestion(parsed, rooms)
      if (!suggestion) {
        logAiCall(session.user.id, task, 'categorise-issue', false, 'off_list_category')
        const payload = {
          ok: true,
          configured: true,
          accepted: false,
          suggestion: null,
          reason: 'off_list_category',
          label: 'Rule-based explanation',
        }
        aiCachePut(cacheKey, payload)
        sendJson(res, 200, payload)
        return
      }
      // Similar reports are computed by the server from stored records for
      // the same room and category; the model never sees or writes them.
      const similar = db
        .listRecords('complaints', active.collegeId)
        .filter(
          (record) =>
            record.data.category === suggestion.category &&
            suggestion.roomId !== null &&
            record.data.roomId === suggestion.roomId,
        )
        .map((record) => ({
          ticketNumber: record.data.ticketNumber ?? record.id,
          status: record.data.status,
          raisedAt: record.data.raisedAt,
        }))
      logAiCall(session.user.id, task, 'categorise-issue', true, 'accepted')
      const payload = {
        ok: true,
        configured: true,
        accepted: true,
        suggestion,
        similarReports: { count: similar.length, samples: similar.slice(0, 3) },
        model: answer.model,
        label: 'AI-generated, please verify',
        checkedAt: new Date().toISOString(),
      }
      aiCachePut(cacheKey, payload)
      sendJson(res, 200, payload)
      return
    }

    // ask-data: the model maps the question to one lookup id; the server
    // computes the answer from stored records and the model never sees data.
    const question = typeof body.question === 'string' ? body.question.trim().slice(0, 500) : ''
    if (!question) throw new HttpError(422, 'Type a question first.')
    const facts = { lookups: AI_LOOKUPS }
    const cacheKey = aiCacheKey(task, active.collegeId, facts, question)
    const cached = aiCacheGet(cacheKey)
    if (cached) {
      logAiCall(
        session.user.id,
        task,
        typeof cached.lookupId === 'string' ? cached.lookupId : 'ask-data',
        cached.mapped === true,
        cached.mapped === true ? 'cache_hit' : String(cached.reason ?? 'cache_hit_rejected'),
      )
      sendJson(res, 200, cached)
      return
    }
    const answer = await runAiTask(aiSettings, 'ask-data', facts, { question })
    if (!answer.ok) {
      logAiCall(session.user.id, task, 'ask-data', false, 'provider_error')
      sendJson(res, 502, { ok: false, configured: true, error: answer.error, text: null, model: answer.model })
      return
    }
    const parsed = extractJson(answer.text)
    const rawId = typeof parsed?.lookupId === 'string' ? parsed.lookupId.trim() : null
    const lookup = AI_LOOKUPS.find((item) => item.id === rawId)
    if (!lookup) {
      // Unknown or missing lookup ids are discarded.
      logAiCall(session.user.id, task, 'ask-data', false, 'unmapped_question')
      const payload = {
        ok: true,
        configured: true,
        mapped: false,
        message: 'I cannot answer that',
        reason: 'unmapped_question',
        supported: AI_LOOKUPS.map((item) => item.question),
      }
      aiCachePut(cacheKey, payload)
      sendJson(res, 200, payload)
      return
    }
    const result = runDataLookup(session, active, lookup.id)
    logAiCall(session.user.id, task, lookup.id, true, 'mapped')
    const payload = {
      ok: true,
      configured: true,
      mapped: true,
      lookupId: lookup.id,
      question: lookup.question,
      title: result.title,
      items: result.items,
      note: result.note,
      label: 'Data from college records — the answer text is not AI-written',
      checkedAt: new Date().toISOString(),
    }
    aiCachePut(cacheKey, payload)
    sendJson(res, 200, payload)
  }

  async function handleDataLookup(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const session = requireSession(req)
    const active = requireActive(req, new URL(req.url ?? '/', 'http://localhost'), session)
    if (!hasCapability(active.role, 'view-plan')) {
      throw new HttpError(403, 'Your role cannot use the data lookups.')
    }
    const body = await readJson(req)
    const lookupId = typeof body.lookupId === 'string' ? body.lookupId.trim() : ''
    const lookup = AI_LOOKUPS.find((item) => item.id === lookupId)
    if (!lookup) {
      sendJson(res, 200, {
        ok: true,
        mapped: false,
        message: 'Choose one of the supported questions.',
        supported: AI_LOOKUPS.map((item) => item.question),
      })
      return
    }
    const result = runDataLookup(session, active, lookup.id)
    sendJson(res, 200, {
      ok: true,
      mapped: true,
      lookupId: lookup.id,
      question: lookup.question,
      title: result.title,
      items: result.items,
      note: result.note,
      label: 'Data from college records — no AI involved',
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
      // Public sign-in only needs names; codes, addresses and emails stay private.
      sendJson(res, 200, {
        colleges: db.listColleges().map((college) => ({ id: college.id, name: college.name })),
      })
      return
    }
    if (method === 'GET' && pathname === '/api/platform/colleges') {
      handlePlatformColleges(req, res)
      return
    }
    if (method === 'POST' && pathname === '/api/platform/colleges') {
      await handlePlatformCollegeCreate(req, res)
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
        label: 'AI-generated, please verify',
      })
      return
    }
    if (method === 'POST' && pathname === '/api/ai/assist') {
      await handleAiAssist(req, res)
      return
    }
    if (method === 'POST' && pathname === '/api/data-lookup') {
      await handleDataLookup(req, res)
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

    const complaintPhotoMatch = pathname.match(/^\/api\/complaints\/([^/]+)\/photo$/)
    if (complaintPhotoMatch && method === 'GET') {
      await handleComplaintPhoto(req, res, decodeURIComponent(complaintPhotoMatch[1]), url)
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

    const needsLimitMatch = pathname.match(/^\/api\/needs-limits\/([^/]+)$/)
    if (needsLimitMatch && method === 'PATCH') {
      await handleNeedsLimit(req, res, decodeURIComponent(needsLimitMatch[1]))
      return
    }

    if (pathname === '/api/priority-weights' && method === 'PATCH') {
      await handlePriorityWeights(req, res)
      return
    }

    if (pathname === '/api/admin/audit' && method === 'GET') {
      handleAdminAudit(req, res)
      return
    }
    if (pathname === '/api/admin/ai-settings' && method === 'GET') {
      handleAdminAiSettings(req, res)
      return
    }
    if (pathname === '/api/admin/role-matrix' && method === 'GET') {
      handleAdminRoleMatrix(req, res)
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
    platformAdmin: session.user.platformAdmin,
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
      if (entity === 'assets') {
        const roomRef = optionalRaw(row.raw.roomId)
        if (roomRef) {
          const room = database.getRecord(roomRef)
          const building = database.getRecord(roomRef)
          const stagedRoom = (prepared.get('rooms') ?? []).find(
            (candidate) => String(candidate.raw.id ?? '') === roomRef,
          )
          const stagedBuilding = (prepared.get('buildings') ?? []).find(
            (candidate) => String(candidate.raw.id ?? '') === roomRef,
          )
          if (stagedRoom) {
            row.raw.buildingId = optionalRaw(stagedRoom.raw.buildingId)
          } else if (room?.entity === 'rooms' && room.collegeId === active.collegeId) {
            row.raw.buildingId = room.data.buildingId
          } else if (stagedBuilding) {
            row.raw.buildingId = roomRef
            row.raw.roomId = null
            row.warnings.push(
              `Room reference "${roomRef}" is a building, not a room; the asset was placed at building level.`,
            )
          } else if (building?.entity === 'buildings' && building.collegeId === active.collegeId) {
            row.raw.buildingId = roomRef
            row.raw.roomId = null
            row.warnings.push(
              `Room reference "${roomRef}" is a building, not a room; the asset was placed at building level.`,
            )
          } else {
            row.warnings.push(
              `Room reference "${roomRef}" did not match a room or building in this college; it is kept as text.`,
            )
          }
        }
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
  if (entity === 'nearbyAssets') {
    if (data.responsibleAuthority === null) {
      warnings.push('Responsible authority is not entered; it stays blank rather than guessed.')
    }
    if (data.condition === null) warnings.push('Condition is not recorded for this nearby asset.')
    if (data.dailyUsers === null) warnings.push('Daily users are not entered for this nearby asset.')
  }
  return warnings
}
