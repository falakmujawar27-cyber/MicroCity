/**
 * Phase H: additive, idempotent bootstrap for the Tiwari pilot workspace.
 *
 * Every record created here is illustrative. Nothing is a measurement or a
 * finding about the real college, apart from the two bus stops that are
 * imported from the supplied workbook and stay Estimated.
 *
 * The bootstrap never edits or deletes existing records and each step is
 * guarded by a marker, so running it repeatedly is safe.
 */
import type { Database } from './db.ts'
import { readNeedsLimits, saveNeedsLimit } from './config.ts'
import type { Complaint, Decision, Inspection, PlanOption, UtilityMeter } from '../src/domain/types.ts'

export const TIWARI_COLLEGE_NAME = 'Shree L.R. Tiwari College of Engineering'
export const TIWARI_COLLEGE_ADDRESS =
  'Kanakia Rd, Kanakia Park, Mira Road East, Mira Bhayandar, Maharashtra 401105'
export const TIWARI_COLLEGE_EMAIL = 'office@tiwari.example.edu'

export const TIWARI_WATER_LIMIT = 700

const SEED_NOTE = 'Tiwari illustrative workspace seed (Phase H). Illustrative placeholder, not a measurement.'

export interface TiwariAccountSeed {
  id: string
  username: string
  displayName: string
  password: string
  role: 'admin' | 'estates' | 'maintenance' | 'faculty' | 'student'
}

export const TIWARI_ACCOUNTS: TiwariAccountSeed[] = [
  { id: 'usr-tw-admin', username: 'tiwari-admin', displayName: 'Tiwari College Administrator', password: 'tiwari-admin-pass', role: 'admin' },
  { id: 'usr-tw-estates', username: 'tiwari-estates', displayName: 'Tiwari Estates Officer', password: 'tiwari-estates-pass', role: 'estates' },
  { id: 'usr-tw-maint', username: 'tiwari-maintenance', displayName: 'Tiwari Maintenance Technician', password: 'tiwari-maintenance-pass', role: 'maintenance' },
  { id: 'usr-tw-faculty', username: 'tiwari-faculty', displayName: 'Tiwari Faculty Member', password: 'tiwari-faculty-pass', role: 'faculty' },
  { id: 'usr-tw-student', username: 'tiwari-student', displayName: 'Tiwari Student', password: 'tiwari-student-pass', role: 'student' },
]

function accountId(db: Database, username: string): string | null {
  return db.getUserByUsername(username)?.id ?? null
}

function findCollegeId(db: Database): string | null {
  return db.listColleges().find((college) => college.name === TIWARI_COLLEGE_NAME)?.id ?? null
}

function hasRecord(db: Database, id: string): boolean {
  return Boolean(db.getRecord(id))
}

function insert(db: Database, entity: string, collegeId: string, id: string, data: Record<string, unknown>, ownerId?: string | null): boolean {
  if (hasRecord(db, id)) return false
  db.insertRecord({
    id,
    entity,
    collegeId,
    ownerId: ownerId ?? null,
    data: { id, collegeId, ...data },
    source: 'seed',
  })
  return true
}

/** Accounts and the water limit never depend on imported records. */
function ensureAccountsAndConfig(db: Database, collegeId: string): boolean {
  const marker = `phase-h:tiwari-accounts:${collegeId}`
  if (db.getMeta(marker)) return false
  let created = 0
  for (const account of TIWARI_ACCOUNTS) {
    if (db.getUserByUsername(account.username)) continue
    db.createAccount({
      id: account.id,
      username: account.username,
      displayName: account.displayName,
      password: account.password,
      collegeId,
      role: account.role,
      sample: true,
    })
    created += 1
  }
  if (!readNeedsLimits(db, collegeId).some((limit) => limit.category === 'water')) {
    saveNeedsLimit(db, collegeId, {
      category: 'water',
      limit: TIWARI_WATER_LIMIT,
      unit: 'm3',
      source: 'Project assumption for demonstration (not a published norm)',
      kind: 'project_assumption',
      updatedAt: new Date().toISOString(),
      updatedByName: 'System (Phase H demo seed)',
    })
  }
  db.setMeta(marker, new Date().toISOString())
  db.addAudit({
    collegeId,
    actorId: 'system',
    actorName: 'System',
    action: 'seed',
    entity: 'memberships',
    entityId: null,
    detail: `Created ${created} illustrative Tiwari account(s) and set the Water project-assumption limit (${TIWARI_WATER_LIMIT} m3 per meter per month).`,
    metadata: null,
  })
  return true
}

/**
 * Meters belong to the buildings imported from the workbook. The workbook
 * names them but carries no building column, so the building is derived from
 * the meter name only when that building exists.
 */
function ensureMeters(db: Database, collegeId: string): boolean {
  const marker = `phase-h:tiwari-meters:${collegeId}`
  if (db.getMeta(marker)) return false
  const buildings = db.listRecords('buildings', collegeId)
  const buildingId = (label: string): string | null => {
    const match = buildings.find((record) => String(record.data.name ?? '').toLowerCase().includes(label))
    return match?.id ?? null
  }
  const mainId = buildingId('main academic')
  const workshopId = buildingId('workshop')
  if (!mainId || !workshopId) return false

  const meters: UtilityMeter[] = [
    {
      id: 'M-ELEC-MAIN', collegeId, buildingId: mainId, utility: 'electricity', unit: 'kWh',
      readingType: 'interval', label: 'Main block electricity', measurementType: 'estimated',
      basis: 'illustrative', provenanceNote: SEED_NOTE,
    },
    {
      id: 'M-ELEC-WORK', collegeId, buildingId: workshopId, utility: 'electricity', unit: 'kWh',
      readingType: 'interval', label: 'Workshop electricity', measurementType: 'estimated',
      basis: 'illustrative', provenanceNote: SEED_NOTE,
    },
    {
      // The workbook labels this meter "Campus water" and gives no building; it
      // is booked to the main block so the campus total has a home.
      id: 'M-WATER-CAMPUS', collegeId, buildingId: mainId, utility: 'water', unit: 'm3',
      readingType: 'interval', label: 'Campus water', measurementType: 'estimated',
      basis: 'illustrative', provenanceNote: SEED_NOTE,
    },
  ]
  let created = 0
  for (const meter of meters) {
    if (insert(db, 'utilityMeters', collegeId, meter.id, { ...meter })) created += 1
  }
  db.setMeta(marker, new Date().toISOString())
  if (created > 0) {
    db.addAudit({
      collegeId,
      actorId: 'system',
      actorName: 'System',
      action: 'seed',
      entity: 'utilityMeters',
      entityId: null,
      detail: `Created ${created} illustrative meter(s) for the workbook's Utility_Readings sheet (monthly consumption, interval readings).`,
      metadata: null,
    })
  }
  return true
}

function ensureWorld(db: Database, collegeId: string): boolean {
  const marker = `phase-h:tiwari-world:${collegeId}`
  if (db.getMeta(marker)) return false
  const rooms = new Set(db.listRecords('rooms', collegeId).map((record) => record.id))
  const buildings = new Set(db.listRecords('buildings', collegeId).map((record) => record.id))
  if (!rooms.has('R-101') || !buildings.has('BLD-1')) return false

  const adminId = accountId(db, 'tiwari-admin')
  const maintenanceId = accountId(db, 'tiwari-maintenance')
  const studentId = accountId(db, 'tiwari-student')
  if (!adminId || !maintenanceId || !studentId) return false

  const complaint = (
    id: string,
    input: {
      raisedAt: string
      category: string
      buildingId: string
      roomId: string | null
      description: string
      severity: 'low' | 'medium' | 'high' | 'critical'
      status: 'open' | 'in_progress' | 'resolved'
      peopleAffected: number
      reporterId: string
      assignedToUserId: string | null
      resolvedAt?: string | null
      ticketNumber: string
    },
  ): boolean => {
    const data: Complaint = {
      id,
      collegeId,
      ticketNumber: input.ticketNumber,
      reporterId: input.reporterId,
      buildingId: input.buildingId,
      roomChoice: input.roomId ? 'room' : 'not_sure',
      roomId: input.roomId,
      assetId: null,
      category: input.category,
      severity: input.severity,
      description: input.description,
      status: input.status,
      raisedAt: `${input.raisedAt}T09:00:00Z`,
      resolvedAt: input.resolvedAt ? `${input.resolvedAt}T15:00:00Z` : null,
      assignedToUserId: input.assignedToUserId,
      peopleAffected: input.peopleAffected,
      photoName: null,
      photoDataUrl: null,
      completionPhotoName: null,
      completionPhotoDataUrl: null,
      basis: 'illustrative',
      provenanceNote: SEED_NOTE,
    }
    return insert(db, 'complaints', collegeId, id, { ...data }, input.reporterId)
  }

  let created = 0
  // Four assigned maintenance jobs: two To do, one In progress, one Done.
  if (complaint('tw-cmp-001', { raisedAt: '2026-11-10', ticketNumber: 'MC-0101', category: 'Electrical', buildingId: 'BLD-1', roomId: 'R-101', description: 'Two ceiling fans at the front of Classroom 101 are not turning.', severity: 'medium', status: 'open', peopleAffected: 58, reporterId: adminId, assignedToUserId: maintenanceId })) created += 1
  if (complaint('tw-cmp-002', { raisedAt: '2026-11-11', ticketNumber: 'MC-0102', category: 'IT and projector', buildingId: 'BLD-1', roomId: 'R-202', description: 'Projector in Classroom 202 has no display on the HDMI input.', severity: 'high', status: 'open', peopleAffected: 68, reporterId: adminId, assignedToUserId: maintenanceId })) created += 1
  if (complaint('tw-cmp-003', { raisedAt: '2026-11-12', ticketNumber: 'MC-0103', category: 'Electrical', buildingId: 'BLD-2', roomId: 'L-001', description: 'Three computers in Computer lab 1 do not power on at the wall socket.', severity: 'medium', status: 'in_progress', peopleAffected: 30, reporterId: adminId, assignedToUserId: maintenanceId })) created += 1
  if (complaint('tw-cmp-004', { raisedAt: '2026-11-08', ticketNumber: 'MC-0104', category: 'Water', buildingId: 'BLD-1', roomId: null, description: 'Ground floor washroom tap was leaking; washer replaced.', severity: 'medium', status: 'resolved', peopleAffected: 40, reporterId: adminId, assignedToUserId: maintenanceId, resolvedAt: '2026-11-09' })) created += 1

  // Student reports owned by the Tiwari student account.
  if (complaint('tw-cmp-101', { raisedAt: '2026-11-13', ticketNumber: 'MC-0105', category: 'Furniture', buildingId: 'BLD-1', roomId: 'R-102', description: 'Back bench in Classroom 102 is broken; two seats cannot be used.', severity: 'low', status: 'open', peopleAffected: 4, reporterId: studentId, assignedToUserId: null })) created += 1
  if (complaint('tw-cmp-102', { raisedAt: '2026-11-14', ticketNumber: 'MC-0106', category: 'Cleaning', buildingId: 'BLD-1', roomId: 'T-101', description: 'Tutorial room 101 bin was not emptied for two days.', severity: 'low', status: 'open', peopleAffected: 30, reporterId: studentId, assignedToUserId: null })) created += 1
  if (complaint('tw-cmp-103', { raisedAt: '2026-11-14', ticketNumber: 'MC-0107', category: 'Electrical', buildingId: 'BLD-1', roomId: 'R-201', description: 'Tube light near the window in Classroom 201 flickers during lectures.', severity: 'medium', status: 'in_progress', peopleAffected: 60, reporterId: studentId, assignedToUserId: null })) created += 1

  const inspections: Inspection[] = [
    {
      id: 'tw-ins-001', collegeId, assetId: 'A-002', scheduledFor: '2026-11-05T09:00:00Z', completedAt: null,
      inspectorUserId: maintenanceId, findings: null, status: 'scheduled', basis: 'illustrative', provenanceNote: SEED_NOTE,
    },
    {
      id: 'tw-ins-002', collegeId, assetId: 'A-007', scheduledFor: '2026-11-20T09:00:00Z', completedAt: null,
      inspectorUserId: maintenanceId, findings: null, status: 'scheduled', basis: 'illustrative', provenanceNote: SEED_NOTE,
    },
  ]
  for (const inspection of inspections) {
    if (insert(db, 'inspections', collegeId, inspection.id, { ...inspection })) created += 1
  }

  const option: PlanOption = {
    id: 'tw-opt-001', collegeId,
    title: 'Add a second tutorial room for the first-year divisions',
    optionType: 'capacity',
    description:
      'Use the spare floor area in the main academic block to add one tutorial room with 30 seats, so first-year tutorials no longer borrow a 60-seat classroom.',
    addressesFinding: 'First-year tutorial bookings exceed the seats in tutorial room 101.',
    capitalCost: null,
    annualCost: null,
    annualSavings: null,
    capacityGainSeats: 30,
    demandReducedSeats: 30,
    disruptionDays: null,
    implementationWeeks: null,
    assumptions: 'Illustrative option. Cost and disruption are deliberately blank until the college supplies them.',
    risks: 'Construction noise during term; the room cannot be used until furniture is installed.',
    evidence: 'Illustrative timetable and attendance rows in this workspace only. No cost or survey evidence.',
    basis: 'illustrative',
    provenanceNote: SEED_NOTE,
  }
  if (insert(db, 'planOptions', collegeId, option.id, { ...option })) created += 1

  const decision: Decision = {
    id: 'tw-dec-001', collegeId, optionId: option.id,
    title: 'Propose the second tutorial room for approval',
    status: 'proposed',
    decidedByUserId: null,
    decidedAt: null,
    ownerUserId: adminId,
    followUp: 'College administrator to confirm the floor area and a furniture budget before any decision.',
    notes: 'Illustrative proposal created for the pilot workspace.',
    createdAt: '2026-11-14T10:00:00Z',
  }
  if (insert(db, 'decisions', collegeId, decision.id, { ...decision })) created += 1

  db.setMeta(marker, new Date().toISOString())
  db.addAudit({
    collegeId,
    actorId: 'system',
    actorName: 'System',
    action: 'seed',
    entity: 'complaints',
    entityId: null,
    detail: `Created ${created} illustrative Tiwari workspace record(s): complaints, inspections, one plan option and a proposed decision.`,
    metadata: null,
  })
  return true
}

/** Runs each guard in order; meters and the world wait for imported buildings. */
export function ensureTiwariWorkspace(db: Database): void {
  const collegeId = findCollegeId(db)
  if (!collegeId) return
  ensureAccountsAndConfig(db, collegeId)
  ensureMeters(db, collegeId)
  ensureWorld(db, collegeId)
}
