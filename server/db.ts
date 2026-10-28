/**
 * SQLite persistence for MicroCity.
 *
 * Node's built-in `node:sqlite` is used so the app has a real server-side
 * database with no native package build. Campus business records are stored
 * as validated JSON documents with an explicit tenancy column; users,
 * memberships, sessions, imports and the audit trail are relational tables.
 * Every campus query is filtered by the authenticated user's college
 * membership in the API layer before it reaches this store.
 */
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { hashPassword, newSalt, hashToken } from './passwords.ts'
import {
  SAMPLE_ACCOUNTS,
  SEED_ASSETS,
  SEED_BUILDINGS,
  SEED_COLLEGES,
  SEED_COMPLAINT_UPDATES,
  SEED_COMPLAINTS,
  SEED_DECISIONS,
  SEED_INSPECTIONS,
  SEED_METERS,
  SEED_PLAN_OPTIONS,
  SEED_PROVENANCE,
  SEED_READINGS,
  SEED_ROOMS,
  SEED_TARIFF_PLACEHOLDER_NOTE,
  SEED_TARIFFS,
  SEED_TIMETABLE,
  SEED_URBAN_ASSETS,
  SEED_URBAN_ISSUES,
} from './seed.ts'

export interface StoredRecord {
  id: string
  entity: string
  collegeId: string | null
  ownerId: string | null
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
  source: string
}

export interface StoredUser {
  id: string
  username: string
  displayName: string
  sample: boolean
}

export interface StoredMembership {
  collegeId: string
  collegeName: string
  role: string
}

export interface AuditRow {
  id: string
  collegeId: string | null
  actorId: string
  actorName: string
  action: string
  entity: string
  entityId: string | null
  detail: string
  at: string
  metadata: string | null
}

export interface ImportRow {
  id: string
  collegeId: string
  actorName: string
  fileName: string
  kind: 'seed' | 'import'
  mode: 'append' | 'replace'
  totalImported: number
  summary: { entity: string; imported: number; skipped: number; rejected: number }[]
  at: string
}

export interface Database {
  sql: DatabaseSync
  close: () => void
  getUserByUsername: (username: string) => (StoredUser & { passwordHash: string; salt: string }) | null
  getUser: (id: string) => StoredUser | null
  getMemberships: (userId: string) => StoredMembership[]
  membershipRole: (userId: string, collegeId: string) => string | null
  listColleges: () => { id: string; name: string }[]
  findCollegeByCode: (code: string) => { id: string; name: string } | null
  createSession: (userId: string, ttlMs: number) => string
  getSessionUser: (token: string) => StoredUser | null
  deleteSession: (token: string) => void
  createAccount: (input: {
    id: string
    username: string
    displayName: string
    password: string
    collegeId: string
    role: string
    sample: boolean
  }) => void
  setMembershipRole: (userId: string, collegeId: string, role: string) => void
  addMembership: (userId: string, collegeId: string, role: string) => void
  listCollegeMembers: (collegeId: string) => (StoredUser & { role: string })[]
  listRecords: (entity: string, collegeId: string | null) => StoredRecord[]
  listCollegeRecords: (collegeId: string, entities: string[]) => StoredRecord[]
  getRecord: (id: string) => StoredRecord | null
  insertRecord: (record: {
    id: string
    entity: string
    collegeId: string | null
    ownerId?: string | null
    data: Record<string, unknown>
    source?: string
    importId?: string | null
    at?: string
  }) => void
  updateRecord: (id: string, data: Record<string, unknown>, at?: string) => void
  deleteRecord: (id: string) => void
  deleteCollegeEntityRecords: (entity: string, collegeId: string) => number
  addAudit: (input: Omit<AuditRow, 'id' | 'at'>) => void
  listAudit: (collegeId: string, limit?: number) => AuditRow[]
  addImportLog: (input: Omit<ImportRow, 'at'> & { at?: string }) => void
  listImportLogs: (collegeId: string, limit?: number) => ImportRow[]
  countEntity: (entity: string, collegeId: string | null) => number
  getMeta: (key: string) => string | null
  setMeta: (key: string, value: string) => void
}

export function createDatabase(path = ':memory:', seed = true): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const sql = new DatabaseSync(path)
  sql.exec('PRAGMA journal_mode = WAL;')
  sql.exec('PRAGMA foreign_keys = ON;')
  sql.exec(`
    CREATE TABLE IF NOT EXISTS colleges (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      sample INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memberships (
      user_id TEXT NOT NULL,
      college_id TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (user_id, college_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      college_id TEXT,
      owner_id TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      import_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_records_entity_college ON records (entity, college_id);
    CREATE INDEX IF NOT EXISTS idx_records_owner ON records (owner_id);
    /* Ticket numbers are human references: one number per college, never two. */
    CREATE UNIQUE INDEX IF NOT EXISTS idx_records_complaint_ticket
      ON records (college_id, json_extract(data, '$.ticketNumber'))
      WHERE entity = 'complaints' AND json_extract(data, '$.ticketNumber') IS NOT NULL;
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      college_id TEXT,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      detail TEXT NOT NULL,
      at TEXT NOT NULL,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_college_at ON audit_logs (college_id, at);
    CREATE TABLE IF NOT EXISTS import_logs (
      id TEXT PRIMARY KEY,
      college_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      mode TEXT NOT NULL,
      total_imported INTEGER NOT NULL,
      summary TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  const collegeColumns = sql.prepare('PRAGMA table_info(colleges)').all() as { name?: string }[]
  if (!collegeColumns.some((column) => column.name === 'code')) {
    sql.exec('ALTER TABLE colleges ADD COLUMN code TEXT')
  }
  const setCollegeCode = sql.prepare(
    "UPDATE colleges SET code = ? WHERE id = ? AND (code IS NULL OR code = '')",
  )
  for (const college of SEED_COLLEGES) setCollegeCode.run(college.code, college.id)

  const getter = sql.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
  const getById = sql.prepare('SELECT * FROM users WHERE id = ?')
  const memberships = sql.prepare(`
    SELECT m.college_id AS collegeId, m.role, c.name AS collegeName
    FROM memberships m JOIN colleges c ON c.id = m.college_id
    WHERE m.user_id = ? ORDER BY c.name
  `)
  const sessionInsert = sql.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
  const sessionLookup = sql.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `)
  const sessionDelete = sql.prepare('DELETE FROM sessions WHERE token_hash = ?')
  const auditInsert = sql.prepare(`
    INSERT INTO audit_logs (id, college_id, actor_id, actor_name, action, entity, entity_id, detail, at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const db: Database = {
    sql,
    close: () => sql.close(),

    getUserByUsername(username) {
      const row = getter.get(username) as Record<string, unknown> | undefined
      if (!row) return null
      return {
        id: String(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
        sample: Number(row.sample) === 1,
        passwordHash: String(row.password_hash),
        salt: String(row.salt),
      }
    },

    getUser(id) {
      const row = getById.get(id) as Record<string, unknown> | undefined
      if (!row) return null
      return {
        id: String(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
        sample: Number(row.sample) === 1,
      }
    },

    getMemberships(userId) {
      return (memberships.all(userId) as Record<string, unknown>[]).map((row) => ({
        collegeId: String(row.collegeId),
        collegeName: String(row.collegeName),
        role: String(row.role),
      }))
    },

    membershipRole(userId, collegeId) {
      const row = sql
        .prepare('SELECT role FROM memberships WHERE user_id = ? AND college_id = ?')
        .get(userId, collegeId) as { role?: string } | undefined
      return row?.role ?? null
    },

    listColleges() {
      return (sql.prepare('SELECT id, name FROM colleges ORDER BY name').all() as Record<string, unknown>[]).map(
        (row) => ({ id: String(row.id), name: String(row.name) }),
      )
    },

    findCollegeByCode(code) {
      const trimmed = code.trim()
      if (!trimmed) return null
      const row = sql
        .prepare('SELECT id, name FROM colleges WHERE code IS NOT NULL AND UPPER(code) = UPPER(?)')
        .get(trimmed) as Record<string, unknown> | undefined
      return row ? { id: String(row.id), name: String(row.name) } : null
    },

    createSession(userId, ttlMs) {
      const token = randomUUID() + randomUUID()
      const now = new Date().toISOString()
      sql.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
      sessionInsert.run(hashToken(token), userId, now, Date.now() + ttlMs)
      return token
    },

    getSessionUser(token) {
      const row = sessionLookup.get(hashToken(token), Date.now()) as Record<string, unknown> | undefined
      if (!row) return null
      return {
        id: String(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
        sample: Number(row.sample) === 1,
      }
    },

    deleteSession(token) {
      sessionDelete.run(hashToken(token))
    },

    createAccount(input) {
      const at = new Date().toISOString()
      const salt = newSalt()
      sql.prepare(
        `INSERT INTO users (id, username, display_name, password_hash, salt, sample, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id,
        input.username,
        input.displayName,
        hashPassword(input.password, salt),
        salt,
        input.sample ? 1 : 0,
        at,
      )
      sql.prepare('INSERT INTO memberships (user_id, college_id, role) VALUES (?, ?, ?)').run(
        input.id,
        input.collegeId,
        input.role,
      )
    },

    setMembershipRole(userId, collegeId, role) {
      sql.prepare('UPDATE memberships SET role = ? WHERE user_id = ? AND college_id = ?').run(role, userId, collegeId)
    },

    addMembership(userId, collegeId, role) {
      sql.prepare(
        'INSERT INTO memberships (user_id, college_id, role) VALUES (?, ?, ?) ON CONFLICT(user_id, college_id) DO UPDATE SET role = excluded.role',
      ).run(userId, collegeId, role)
    },

    listCollegeMembers(collegeId) {
      return (
        sql
          .prepare(
            `SELECT u.id, u.username, u.display_name, u.sample, m.role
             FROM memberships m JOIN users u ON u.id = m.user_id
             WHERE m.college_id = ? ORDER BY m.role, u.display_name`,
          )
          .all(collegeId) as Record<string, unknown>[]
      ).map((row) => ({
        id: String(row.id),
        username: String(row.username),
        displayName: String(row.display_name),
        sample: Number(row.sample) === 1,
        role: String(row.role),
      }))
    },

    listRecords(entity, collegeId) {
      const rows =
        collegeId === null
          ? (sql
              .prepare('SELECT * FROM records WHERE entity = ? AND college_id IS NULL ORDER BY created_at')
              .all(entity) as Record<string, unknown>[])
          : (sql
              .prepare('SELECT * FROM records WHERE entity = ? AND college_id = ? ORDER BY created_at')
              .all(entity, collegeId) as Record<string, unknown>[])
      return rows.map(rowToRecord)
    },

    listCollegeRecords(collegeId, entities) {
      if (entities.length === 0) return []
      const placeholders = entities.map(() => '?').join(',')
      const rows = sql
        .prepare(`SELECT * FROM records WHERE college_id = ? AND entity IN (${placeholders}) ORDER BY created_at`)
        .all(collegeId, ...entities) as Record<string, unknown>[]
      return rows.map(rowToRecord)
    },

    getRecord(id) {
      const row = sql.prepare('SELECT * FROM records WHERE id = ?').get(id) as Record<string, unknown> | undefined
      return row ? rowToRecord(row) : null
    },

    insertRecord(record) {
      const at = record.at ?? new Date().toISOString()
      sql.prepare(
        `INSERT INTO records (id, entity, college_id, owner_id, data, created_at, updated_at, source, import_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        record.entity,
        record.collegeId,
        record.ownerId ?? null,
        JSON.stringify(record.data),
        at,
        at,
        record.source ?? 'manual',
        record.importId ?? null,
      )
    },

    updateRecord(id, data, at = new Date().toISOString()) {
      sql.prepare('UPDATE records SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), at, id)
    },

    deleteRecord(id) {
      sql.prepare('DELETE FROM records WHERE id = ?').run(id)
    },

    deleteCollegeEntityRecords(entity, collegeId) {
      const result = sql
        .prepare('DELETE FROM records WHERE entity = ? AND college_id = ?')
        .run(entity, collegeId)
      return Number(result.changes)
    },

    addAudit(input) {
      auditInsert.run(
        `aud-${randomUUID()}`,
        input.collegeId,
        input.actorId,
        input.actorName,
        input.action,
        input.entity,
        input.entityId,
        input.detail,
        new Date().toISOString(),
        input.metadata,
      )
    },

    listAudit(collegeId, limit = 100) {
      const rows = sql
        .prepare(
          `SELECT id, college_id AS collegeId, actor_id AS actorId, actor_name AS actorName, action,
                  entity, entity_id AS entityId, detail, at, metadata
           FROM audit_logs WHERE college_id = ? ORDER BY at DESC LIMIT ?`,
        )
        .all(collegeId, limit) as Record<string, unknown>[]
      return rows.map((row) => ({
        id: String(row.id),
        collegeId: row.collegeId === null ? null : String(row.collegeId),
        actorId: String(row.actorId),
        actorName: String(row.actorName),
        action: String(row.action),
        entity: String(row.entity),
        entityId: row.entityId === null ? null : String(row.entityId),
        detail: String(row.detail),
        at: String(row.at),
        metadata: row.metadata === null ? null : String(row.metadata),
      }))
    },

    addImportLog(input) {
      sql.prepare(
        `INSERT INTO import_logs (id, college_id, actor_name, file_name, kind, mode, total_imported, summary, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.id,
        input.collegeId,
        input.actorName,
        input.fileName,
        input.kind,
        input.mode,
        input.totalImported,
        JSON.stringify(input.summary),
        input.at ?? new Date().toISOString(),
      )
    },

    listImportLogs(collegeId, limit = 50) {
      const rows = sql
        .prepare(
          `SELECT id, college_id AS collegeId, actor_name AS actorName, file_name AS fileName, kind, mode,
                  total_imported AS totalImported, summary, at
           FROM import_logs WHERE college_id = ? ORDER BY at DESC LIMIT ?`,
        )
        .all(collegeId, limit) as Record<string, unknown>[]
      return rows.map((row) => ({
        id: String(row.id),
        collegeId: String(row.collegeId),
        actorName: String(row.actorName),
        fileName: String(row.fileName),
        kind: row.kind === 'seed' ? 'seed' : 'import',
        mode: row.mode === 'replace' ? 'replace' : 'append',
        totalImported: Number(row.totalImported),
        summary: JSON.parse(String(row.summary)) as ImportRow['summary'],
        at: String(row.at),
      }))
    },

    countEntity(entity, collegeId) {
      const row =
        collegeId === null
          ? (sql.prepare('SELECT COUNT(*) AS n FROM records WHERE entity = ? AND college_id IS NULL').get(entity) as { n: number })
          : (sql.prepare('SELECT COUNT(*) AS n FROM records WHERE entity = ? AND college_id = ?').get(entity, collegeId) as { n: number })
      return Number(row.n)
    },

    getMeta(key) {
      const row = sql.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value?: string } | undefined
      return row?.value ?? null
    },

    setMeta(key, value) {
      sql.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
    },
  }

  if (seed) {
    seedDatabase(db)
    applyDemoLocalisation(db)
    applyPhaseCTickets(db)
  }
  return db
}

function rowToRecord(row: Record<string, unknown>): StoredRecord {
  return {
    id: String(row.id),
    entity: String(row.entity),
    collegeId: row.college_id === null ? null : String(row.college_id),
    ownerId: row.owner_id === null ? null : String(row.owner_id),
    data: JSON.parse(String(row.data)) as Record<string, unknown>,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    source: String(row.source),
  }
}

export function seedDatabase(db: Database): void {
  const existing = db.sql.prepare('SELECT COUNT(*) AS n FROM colleges').get() as { n: number }
  if (Number(existing.n) > 0) return

  db.sql.exec('BEGIN')
  try {
    const collegeInsert = db.sql.prepare('INSERT INTO colleges (id, name, code) VALUES (?, ?, ?)')
    for (const college of SEED_COLLEGES) collegeInsert.run(college.id, college.name, college.code)

    for (const account of SAMPLE_ACCOUNTS) {
      db.createAccount({
        id: account.id,
        username: account.username,
        displayName: account.displayName,
        password: account.password,
        collegeId: account.collegeId,
        role: account.role,
        sample: true,
      })
    }

    const seedAt = SEED_PROVENANCE.generatedAt
    const seedRecord = (
      entity: string,
      collegeId: string | null,
      data: Record<string, unknown>,
      ownerId: string | null = null,
    ) =>
      db.insertRecord({
        id: String(data.id),
        entity,
        collegeId,
        ownerId,
        data,
        source: 'seed',
        at: seedAt,
      })

    const counts = new Map<string, Map<string, number>>()
    const bumpCount = (collegeId: string, entity: string) => {
      const inner = counts.get(collegeId) ?? new Map<string, number>()
      inner.set(entity, (inner.get(entity) ?? 0) + 1)
      counts.set(collegeId, inner)
    }
    const campusEntities: [string, { id: string; collegeId: string }[]][] = [
      ['buildings', SEED_BUILDINGS],
      ['rooms', SEED_ROOMS],
      ['timetableSlots', SEED_TIMETABLE],
      ['assets', SEED_ASSETS],
      ['inspections', SEED_INSPECTIONS],
      ['utilityMeters', SEED_METERS],
      ['utilityReadings', SEED_READINGS],
      ['tariffs', SEED_TARIFFS],
      ['complaints', SEED_COMPLAINTS],
      ['complaintUpdates', SEED_COMPLAINT_UPDATES],
      ['planOptions', SEED_PLAN_OPTIONS],
      ['decisions', SEED_DECISIONS],
    ]

    for (const [entity, records] of campusEntities) {
      for (const record of records) {
        const data = record as unknown as Record<string, unknown>
        const ownerId =
          entity === 'complaints'
            ? String((record as unknown as { reporterId: string }).reporterId)
            : null
        seedRecord(entity, record.collegeId, data, ownerId)
        bumpCount(record.collegeId, entity)
      }
    }
    for (const asset of SEED_URBAN_ASSETS) seedRecord('urbanAssets', null, asset as unknown as Record<string, unknown>)
    for (const issue of SEED_URBAN_ISSUES) {
      seedRecord('urbanIssues', null, issue as unknown as Record<string, unknown>, issue.reporterId)
    }

    db.setMeta('provenance', JSON.stringify(SEED_PROVENANCE))
    db.setMeta('seededAt', seedAt)
    db.setMeta('baseDataset', SEED_PROVENANCE.name)

    for (const college of SEED_COLLEGES) {
      const summary = [...(counts.get(college.id)?.entries() ?? [])].map(([entity, imported]) => ({
        entity,
        imported,
        skipped: 0,
        rejected: 0,
      }))
      db.addImportLog({
        id: `imp-seed-${college.id}`,
        collegeId: college.id,
        actorName: 'MicroCity seed',
        fileName: `${SEED_PROVENANCE.name} (synthetic seed)`,
        kind: 'seed',
        mode: 'append',
        totalImported: summary.reduce((sum, row) => sum + row.imported, 0),
        summary,
        at: seedAt,
      })
    }

    db.addAudit({
      collegeId: null,
      actorId: 'system',
      actorName: 'MicroCity',
      action: 'seed',
      entity: 'workspace',
      entityId: null,
      detail: `Seeded synthetic demonstration workspace ${SEED_PROVENANCE.name}.`,
      metadata: null,
    })

    db.sql.exec('COMMIT')
  } catch (error) {
    db.sql.exec('ROLLBACK')
    throw error
  }
}

/**
 * Additive, idempotent Phase C backfill: give every existing complaint a
 * human-readable ticket reference. Records that already carry one keep it, so
 * rerunning never renumbers a ticket a person has already been given.
 */
export function applyPhaseCTickets(db: Database): void {
  const MARKER = 'phase-c-tickets-2026-10'
  if (db.getMeta('phaseCTickets') === MARKER) return

  const ticketValue = (value: unknown): number => {
    const match = typeof value === 'string' ? value.match(/^MC-(\d+)$/) : null
    return match ? Number(match[1]) : 0
  }

  db.sql.exec('BEGIN')
  try {
    for (const college of db.listColleges()) {
      const existing = db.listRecords('complaints', college.id)
      let highest = 0
      for (const record of existing) highest = Math.max(highest, ticketValue(record.data.ticketNumber))

      const missing = existing
        .filter((record) => !ticketValue(record.data.ticketNumber))
        .sort(
          (a, b) =>
            String(a.data.raisedAt ?? '').localeCompare(String(b.data.raisedAt ?? '')) ||
            a.id.localeCompare(b.id),
        )

      for (const record of missing) {
        highest += 1
        db.updateRecord(record.id, {
          ...record.data,
          ticketNumber: `MC-${String(highest).padStart(4, '0')}`,
        })
      }
    }
    db.setMeta('phaseCTickets', MARKER)
    db.sql.exec('COMMIT')
  } catch (error) {
    db.sql.exec('ROLLBACK')
    throw error
  }
}

/**
 * One-time, idempotent localisation of an already-seeded database.
 * Only seed-owned records are rewritten, and only when they still hold the
 * original value, so user edits and imported records are never overwritten.
 */
export function applyDemoLocalisation(db: Database): void {
  const MARKER = 'phase-a-localisation-2026-10d'
  if (db.getMeta('localisation') === MARKER) return

  const replace = (data: Record<string, unknown>, key: string, from: string, to: string): boolean => {
    if (data[key] !== from) return false
    data[key] = to
    return true
  }
  const updateSeed = (id: string, apply: (data: Record<string, unknown>) => boolean) => {
    const record = db.getRecord(id)
    if (!record || record.source !== 'seed') return
    const next = { ...record.data }
    if (apply(next)) db.updateRecord(id, next)
  }

  db.sql.exec('BEGIN')
  try {
    const college = db.sql.prepare('UPDATE colleges SET name = ? WHERE id = ? AND name = ?')
    college.run('Vidya Nagar College (fictional)', 'clg-bv', 'Brookvale College (fictional)')
    college.run('Seva Nagar College (fictional)', 'clg-fd', 'Foundry Lane College (fictional)')

    const user = db.sql.prepare('UPDATE users SET display_name = ? WHERE id = ? AND display_name = ?')
    user.run('Sample Admin - Vidya Nagar', 'usr-bv-admin', 'Sample Admin - Brookvale')
    user.run('Sample Admin - Seva Nagar', 'usr-fd-admin', 'Sample Admin - Foundry Lane')
    user.run('Sample Estates Officer - Seva Nagar', 'usr-fd-estates', 'Sample Estates Officer - Foundry')
    user.run('Sample Student - Seva Nagar', 'usr-fd-student', 'Sample Student - Foundry')

    updateSeed('bld-bv-main', (data) =>
      replace(data, 'address', '1 Demo Way (invented)', 'Approach road near college gate (synthetic)'),
    )
    updateSeed('bld-bv-library', (data) =>
      replace(data, 'address', '3 Demo Way (invented)', 'Library block, near college gate (synthetic)'),
    )
    updateSeed('bld-fd-court', (data) => {
      let changed = replace(data, 'name', 'Foundry Court (fictional)', 'Seva Nagar Academic Block (fictional)')
      changed = replace(data, 'address', '2 Demo Way (invented)', 'Campus approach road (synthetic)') || changed
      return changed
    })

    updateSeed('rm-fd-f1', (data) => replace(data, 'name', 'Foundry lecture room', 'Lecture room F1'))
    updateSeed('rm-fd-f2', (data) => replace(data, 'name', 'Foundry seminar room', 'Seminar room F2'))

    updateSeed('mtr-fd-e1', (data) => replace(data, 'label', 'Foundry Court electricity', 'Academic block electricity'))
    updateSeed('mtr-fd-w1', (data) => replace(data, 'label', 'Foundry Court water', 'Academic block water'))

    updateSeed('ast-fd-boiler', (data) => replace(data, 'name', 'Foundry boiler (fictional)', 'Academic block boiler (fictional)'))
    updateSeed('cupd-fd-1', (data) =>
      replace(data, 'actorName', 'Sample Student - Foundry', 'Sample Student - Seva Nagar'),
    )

    // Tariffs become neutral placeholders, but only when they still hold a
    // value this seed itself wrote. A rate entered by a user is left alone.
    const tariff = (
      id: string,
      previous: { currency: string; ratePerUnit: number; standingChargePerPeriod: number }[],
    ) =>
      updateSeed(id, (data) => {
        const matches = previous.some(
          (entry) =>
            data.currency === entry.currency &&
            data.ratePerUnit === entry.ratePerUnit &&
            data.standingChargePerPeriod === entry.standingChargePerPeriod,
        )
        if (!matches) return false
        data.currency = 'INR'
        data.ratePerUnit = null
        data.standingChargePerPeriod = null
        data.note = SEED_TARIFF_PLACEHOLDER_NOTE
        return true
      })
    tariff('trf-bv-e', [
      { currency: 'GBP', ratePerUnit: 0.24, standingChargePerPeriod: 35 },
      { currency: 'INR', ratePerUnit: 8.5, standingChargePerPeriod: 500 },
    ])
    tariff('trf-bv-w', [
      { currency: 'GBP', ratePerUnit: 1.85, standingChargePerPeriod: 60 },
      { currency: 'INR', ratePerUnit: 25, standingChargePerPeriod: 300 },
    ])
    tariff('trf-fd-e', [
      { currency: 'GBP', ratePerUnit: 0.26, standingChargePerPeriod: 28 },
      { currency: 'INR', ratePerUnit: 9.2, standingChargePerPeriod: 450 },
    ])
    tariff('trf-fd-w', [
      { currency: 'GBP', ratePerUnit: 1.72, standingChargePerPeriod: 50 },
      { currency: 'INR', ratePerUnit: 22, standingChargePerPeriod: 250 },
    ])

    updateSeed('ua-1', (data) => {
      let changed = replace(data, 'locationLabel', 'Main Street, opposite the college gate', 'Approach road near college gate')
      changed = replace(data, 'ownerAuthority', 'City Streets Department (fictional)', 'Local ward office (synthetic)') || changed
      return changed
    })
    updateSeed('ua-2', (data) => {
      let changed = replace(data, 'locationLabel', 'Mill Lane footway', 'Footpath near college gate')
      changed = replace(data, 'ownerAuthority', 'City Streets Department (fictional)', 'Local ward office (synthetic)') || changed
      return changed
    })
    updateSeed('ua-3', (data) => {
      let changed = replace(data, 'name', 'Campus stop B (fictional)', 'Campus bus stop (fictional)')
      changed = replace(data, 'locationLabel', 'Main Street, northbound', 'Bus stop near college gate') || changed
      changed = replace(data, 'ownerAuthority', 'Regional Transit Authority (fictional)', 'Local transport office (synthetic)') || changed
      return changed
    })
    updateSeed('ua-4', (data) => {
      let changed = replace(data, 'name', 'Greenway cycle path (fictional)', 'Cycle path near campus (fictional)')
      changed = replace(data, 'locationLabel', 'Riverside greenway', 'Cycle path near campus') || changed
      changed = replace(data, 'ownerAuthority', 'City Streets Department (fictional)', 'Local ward office (synthetic)') || changed
      return changed
    })
    updateSeed('ua-5', (data) => {
      let changed = replace(data, 'name', 'Foundry Lane gully (fictional)', 'Storm drain near college gate (fictional)')
      changed = replace(data, 'locationLabel', 'Foundry Lane entrance', 'College gate entrance') || changed
      changed = replace(data, 'ownerAuthority', 'City Drainage Team (fictional)', 'Local ward office (synthetic)') || changed
      return changed
    })

    updateSeed('ui-1', (data) => {
      let changed = replace(data, 'locationLabel', 'Main Street, opposite the college gate', 'Approach road near college gate')
      changed = replace(data, 'authority', 'City Streets Department (fictional)', 'Local ward office (synthetic)') || changed
      return changed
    })
    updateSeed('ui-2', (data) => {
      let changed = replace(data, 'locationLabel', 'Mill Lane footway', 'Footpath near college gate')
      changed = replace(data, 'authority', 'City Streets Department (fictional)', 'Local ward office (synthetic)') || changed
      return changed
    })
    updateSeed('ui-3', (data) => {
      let changed = replace(data, 'locationLabel', 'Main Street, northbound', 'Bus stop near college gate')
      changed = replace(data, 'authority', 'Regional Transit Authority (fictional)', 'Local transport office (synthetic)') || changed
      return changed
    })
    updateSeed('ui-4', (data) => {
      let changed = replace(data, 'locationLabel', 'Foundry Lane entrance', 'College gate entrance')
      changed = replace(data, 'authority', 'City Drainage Team (fictional)', 'Local ward office (synthetic)') || changed
      return changed
    })

    const provenanceRaw = db.getMeta('provenance')
    if (provenanceRaw) {
      try {
        const provenance = JSON.parse(provenanceRaw) as Record<string, unknown>
        if (
          typeof provenance.generator === 'string' &&
          provenance.generator.startsWith('MicroCity hand-authored deterministic seed')
        ) {
          provenance.generator = 'MicroCity hand-authored demonstration dataset; no AI, no scraped or sensor data'
        }
        if (typeof provenance.notes === 'string') {
          provenance.notes = provenance.notes
            .replace(/\s*smartcampus_test_data\.xlsx was not provided and is not represented by this seed\./, '')
            .trim()
        }
        db.setMeta('provenance', JSON.stringify(provenance))
      } catch {
        /* keep the stored provenance if it is not readable JSON */
      }
    }

    for (const complaint of SEED_COMPLAINTS) {
      updateSeed(complaint.id, (data) => {
        let changed = false
        if (!data.buildingId) {
          data.buildingId = complaint.buildingId
          changed = true
        }
        if (!data.roomChoice) {
          data.roomChoice = complaint.roomChoice
          changed = true
        }
        return changed
      })
    }

    db.setMeta('localisation', MARKER)
    db.sql.exec('COMMIT')
  } catch (error) {
    db.sql.exec('ROLLBACK')
    throw error
  }
}
