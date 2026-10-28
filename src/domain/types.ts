/**
 * MicroCity domain types — shared by the browser app and the Node API.
 *
 * Record-level rules:
 * - Campus-owned records carry `collegeId`; the API also stores it as a
 *   tenancy column and rejects cross-college references.
 * - Public urban infrastructure records never carry a college owner.
 * - Missing measurements are `null`, never zero.
 * - Timestamps are ISO 8601 strings.
 */

export type UserRole = 'admin' | 'estates' | 'maintenance' | 'faculty' | 'student'

export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type AssetCondition = 'good' | 'fair' | 'poor'
export type UtilityType = 'electricity' | 'water'
export type ReadingType = 'cumulative' | 'interval'
export type ComplaintStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type ComplaintRoomChoice = 'room' | 'not_sure'
export type UrbanIssueStatus = 'reported' | 'in_progress' | 'resolved' | 'closed'
export type InspectionStatus = 'scheduled' | 'completed' | 'cancelled'
/** What the technician recorded when they carried out an inspection. */
export type InspectionResult = 'no_issues' | 'issues_found'
export const INSPECTION_RESULTS: InspectionResult[] = ['no_issues', 'issues_found']
export type AttendanceReason = 'room_too_small' | 'too_hot' | 'projector_not_working'
export type DecisionStatus = 'proposed' | 'approved' | 'rejected' | 'deferred'
export type OptionType = 'timetable' | 'capacity' | 'maintenance' | 'infrastructure' | 'other'

export type UrbanAssetCategory =
  | 'street_lighting'
  | 'footway'
  | 'road'
  | 'cycle_path'
  | 'bus_stop'
  | 'drainage'
  | 'park'
  | 'other'

export interface College {
  id: string
  name: string
}

export interface Membership {
  collegeId: string
  collegeName: string
  role: UserRole
}

export interface AuthUser {
  id: string
  username: string
  displayName: string
  sample: boolean
}

export interface SessionInfo {
  user: AuthUser
  memberships: Membership[]
}

export interface UserSummary {
  id: string
  displayName: string
  role: UserRole
  sample: boolean
}

export interface Building {
  id: string
  collegeId: string
  name: string
  address: string | null
  notes: string | null
}

export interface Room {
  id: string
  collegeId: string
  buildingId: string
  code: string
  name: string | null
  floor: string | null
  areaM2: number | null
  capacity: number | null
  condition: AssetCondition | null
  notes: string | null
}

export interface TimetableSlot {
  id: string
  collegeId: string
  roomId: string
  startsAt: string
  endsAt: string
  activity: string
  moduleCode: string | null
  /** Expected class size (demand). null = not recorded, never assumed zero. */
  expectedAttendance: number | null
  /** Actual attendance (occupancy evidence). null = not captured. */
  attendance: number | null
}

export interface AttendanceRecord {
  id: string
  collegeId: string
  slotId: string
  /** Calendar date of the session in IST (YYYY-MM-DD). */
  sessionDate: string
  present: number
  /** Expected attendance copied from the timetable when the record was saved. */
  enrolled: number
  reasons: AttendanceReason[]
  recordedByUserId: string
  recordedByName: string
  recordedAt: string
  updatedAt: string
}

export interface UtilityMeter {
  id: string
  collegeId: string
  buildingId: string
  utility: UtilityType
  unit: string
  readingType: ReadingType
  label: string
}

export interface UtilityReading {
  id: string
  collegeId: string
  meterId: string
  readAt: string
  /** Meter register value (cumulative) or period consumption (interval). null = missing. */
  value: number | null
  unit: string
  note: string | null
}

export interface Tariff {
  id: string
  collegeId: string
  utility: UtilityType
  unit: string
  currency: string
  /** Null means the rate has not been entered from a bill yet. */
  ratePerUnit: number | null
  standingChargePerPeriod: number | null
  effectiveFrom: string
  note: string | null
}

export interface Asset {
  id: string
  collegeId: string
  buildingId: string | null
  name: string
  category: string
  installedAt: string | null
  condition: AssetCondition | null
  lastInspectedAt: string | null
  inspectionIntervalDays: number | null
  criticality: Severity | null
  notes: string | null
}

export interface Inspection {
  id: string
  collegeId: string
  assetId: string
  scheduledFor: string
  completedAt: string | null
  inspectorUserId: string | null
  findings: string | null
  status: InspectionStatus
  /** Added when the technician records an inspection; older rows have none. */
  result?: InspectionResult | null
}

export interface Complaint {
  id: string
  collegeId: string
  /** Human-readable reference, generated per college for new reports. */
  ticketNumber?: string | null
  reporterId: string
  /** Display-only enrichment from the API. */
  reporterName?: string
  /** Required for new complaints; null is retained for older imported records. */
  buildingId: string | null
  roomChoice: ComplaintRoomChoice | null
  roomId: string | null
  assetId: string | null
  category: string
  severity: Severity
  description: string
  status: ComplaintStatus
  raisedAt: string
  resolvedAt: string | null
  assignedToUserId: string | null
  /** Display-only enrichment from the API. */
  assignedToName?: string | null
  peopleAffected: number | null
  photoName: string | null
  photoDataUrl: string | null
  /** Written by the maintenance technician when a job is marked done. */
  completionNote?: string | null
  completionPhotoName?: string | null
  completionPhotoDataUrl?: string | null
}

export interface ComplaintUpdate {
  id: string
  collegeId: string
  complaintId: string
  at: string
  actorId: string
  actorName: string
  kind: 'created' | 'assigned' | 'status' | 'note' | 'category'
  note: string
  fromStatus: ComplaintStatus | null
  toStatus: ComplaintStatus | null
}

export interface UrbanAsset {
  id: string
  category: UrbanAssetCategory
  name: string | null
  locationLabel: string | null
  ownerAuthority: string | null
}

export interface UrbanIssue {
  id: string
  urbanAssetId: string | null
  reporterId: string
  reporterName?: string
  category: string
  severity: Severity
  description: string
  locationLabel: string
  authority: string | null
  reportedAt: string
  status: UrbanIssueStatus
  resolvedAt: string | null
  note?: string | null
  photoName: string | null
  photoDataUrl: string | null
}

export interface PlanOption {
  id: string
  collegeId: string
  title: string
  optionType: OptionType
  description: string
  addressesFinding: string
  capitalCost: number | null
  annualCost: number | null
  annualSavings: number | null
  capacityGainSeats: number | null
  demandReducedSeats: number | null
  disruptionDays: number | null
  implementationWeeks: number | null
  assumptions: string
  risks: string
  evidence: string
}

export interface Decision {
  id: string
  collegeId: string
  optionId: string
  title: string
  status: DecisionStatus
  decidedByUserId: string | null
  decidedByName?: string | null
  decidedAt: string | null
  ownerUserId: string | null
  ownerName?: string | null
  followUp: string
  notes: string
  createdAt: string
}

export interface DatasetProvenance {
  name: string
  synthetic: boolean
  generatedAt: string
  generator: string
  source: string | null
  license: string
  notes: string
}

export interface DatasetSources {
  buildings: Building[]
  rooms: Room[]
  timetableSlots: TimetableSlot[]
  attendanceRecords: AttendanceRecord[]
  assets: Asset[]
  inspections: Inspection[]
  utilityMeters: UtilityMeter[]
  utilityReadings: UtilityReading[]
  tariffs: Tariff[]
  complaints: Complaint[]
  complaintUpdates: ComplaintUpdate[]
  planOptions: PlanOption[]
  decisions: Decision[]
  urbanAssets: UrbanAsset[]
  urbanIssues: UrbanIssue[]
}

export interface Dataset {
  provenance: DatasetProvenance
  sources: DatasetSources
}

export interface ImportEntitySummary {
  entity: string
  imported: number
  skipped: number
  rejected: number
}

export interface ImportSheetInput {
  entity: string
  rows: Record<string, unknown>[]
}

export interface ImportRowOutcome {
  rowNumber: number
  status: 'imported' | 'skipped' | 'rejected'
  id: string | null
  message: string | null
  errors: Record<string, string>
  warnings: string[]
}

export interface ImportEntityOutcome {
  entity: string
  label: string
  imported: number
  skipped: number
  rejected: number
  rows: ImportRowOutcome[]
}

export interface ImportOutcome {
  fileName: string
  mode: 'append' | 'replace'
  preview: boolean
  applied: boolean
  canApply: boolean
  blocked: string[]
  notices: string[]
  entities: ImportEntityOutcome[]
  totals: { imported: number; skipped: number; rejected: number }
  importId: string | null
}

export interface ImportLogEntry {
  id: string
  collegeId: string
  at: string
  actorName: string
  fileName: string
  kind: 'seed' | 'import'
  mode: 'append' | 'replace'
  totalImported: number
  summary: ImportEntitySummary[]
}

export interface AuditEntry {
  id: string
  at: string
  actorName: string
  action: string
  entity: string
  entityId: string | null
  detail: string
}

export interface WorkspacePayload {
  activeCollege: { id: string; name: string; role: UserRole }
  memberships: Membership[]
  provenance: DatasetProvenance
  dataset: DatasetSources
  imports: ImportLogEntry[]
  audit: AuditEntry[]
  members: UserSummary[]
  serverTime: string
}

export interface RegisterInput {
  username: string
  displayName: string
  password: string
  /** The college code proves the person belongs to that college. */
  collegeCode: string
  role: 'student' | 'faculty'
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  estates: 'Estates',
  maintenance: 'Maintenance',
  faculty: 'Faculty',
  student: 'Student',
}

export const ATTENDANCE_REASON_LABELS: Record<AttendanceReason, string> = {
  room_too_small: 'Room too small',
  too_hot: 'Too hot',
  projector_not_working: 'Projector not working',
}

export const ATTENDANCE_REASONS: AttendanceReason[] = [
  'room_too_small',
  'too_hot',
  'projector_not_working',
]

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

export const COMPLAINT_CATEGORIES = [
  'Electrical',
  'Plumbing',
  'Heating / cooling',
  'Room fabric',
  'Furniture',
  'IT / network',
  'Cleaning',
  'Safety',
  'Accessibility',
  'Grounds',
  'Other',
] as const

export const ASSET_CATEGORIES = [
  'heating',
  'ventilation',
  'electrical',
  'plumbing',
  'workshop',
  'IT / network',
  'security',
  'grounds',
  'furniture',
  'other',
] as const

export const URBAN_CATEGORY_LABELS: Record<UrbanAssetCategory, string> = {
  street_lighting: 'Street lighting',
  footway: 'Footway',
  road: 'Road',
  cycle_path: 'Cycle path',
  bus_stop: 'Bus stop',
  drainage: 'Drainage',
  park: 'Park',
  other: 'Other',
}
