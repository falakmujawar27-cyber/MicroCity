import { NEARBY_TYPE_LABELS } from './types.ts'
import type { AssetCondition, Severity, UrbanAssetCategory, UtilityType, ComplaintStatus, InspectionStatus, ReadingType, OptionType } from './types.ts'

export type FieldType =
  | 'string'
  | 'nullable-string'
  | 'number'
  | 'nullable-number'
  | 'integer'
  | 'nullable-integer'
  | 'iso-date'
  | 'nullable-iso-date'
  | 'enum'
  | 'nullable-enum'

export interface FieldSpec {
  key: string
  label: string
  type: FieldType
  required: boolean
  enumValues?: readonly string[]
  aliases: string[]
  note?: string
}

export interface EntitySpec {
  entity: string
  label: string
  scope: 'campus' | 'public'
  importable: boolean
  fields: FieldSpec[]
  order: number
  naturalKey: string
}

const idField: FieldSpec = {
  key: 'id',
  label: 'ID',
  type: 'nullable-string',
  required: false,
  aliases: ['id', 'identifier', 'record id', 'code id'],
  note: 'Optional. Use stable IDs when other sheets reference this record.',
}

const conditionEnum: readonly AssetCondition[] = ['good', 'fair', 'poor']
const severityEnum: readonly Severity[] = ['low', 'medium', 'high', 'critical']
const utilityEnum: readonly UtilityType[] = ['electricity', 'water']
const complaintStatusEnum: readonly ComplaintStatus[] = ['open', 'in_progress', 'resolved', 'closed']
const complaintRoomChoiceEnum = ['room', 'not_sure'] as const
const inspectionStatusEnum: readonly InspectionStatus[] = ['scheduled', 'completed', 'cancelled']
const readingTypeEnum: readonly ReadingType[] = ['cumulative', 'interval']
const optionTypeEnum: readonly OptionType[] = ['timetable', 'capacity', 'maintenance', 'infrastructure', 'other']
const urbanAssetCategoryEnum: readonly UrbanAssetCategory[] = [
  'street_lighting', 'footway', 'road', 'cycle_path', 'bus_stop', 'drainage', 'park', 'other',
]

export const ENTITY_SPECS: EntitySpec[] = [
  {
    entity: 'nearbyAssets',
    label: 'Nearby assets',
    scope: 'campus',
    importable: false,
    order: 16,
    naturalKey: 'ID',
    fields: [
      idField,
      { key: 'type', label: 'Type', type: 'enum', required: true, enumValues: Object.keys(NEARBY_TYPE_LABELS), aliases: [] },
      { key: 'locationDescription', label: 'Location description', type: 'string', required: true, aliases: [] },
      { key: 'distanceMetres', label: 'Distance from college gate (m)', type: 'number', required: true, aliases: [] },
      { key: 'distanceBasis', label: 'Distance basis', type: 'enum', required: true, enumValues: ['measured', 'estimated'], aliases: [] },
      { key: 'condition', label: 'Condition', type: 'nullable-enum', required: false, enumValues: conditionEnum, aliases: [] },
      { key: 'dailyUsers', label: 'Estimated daily users', type: 'nullable-integer', required: false, aliases: [] },
      { key: 'usersMethod', label: 'How daily users were obtained', type: 'nullable-string', required: false, aliases: [] },
      { key: 'responsibleAuthority', label: 'Responsible authority', type: 'string', required: true, aliases: [] },
      { key: 'basis', label: 'Basis tag', type: 'enum', required: true, enumValues: ['measured', 'estimated', 'illustrative'], aliases: [] },
    ],
  },
  {
    entity: 'buildings',
    label: 'Buildings',
    scope: 'campus',
    importable: true,
    order: 1,
    naturalKey: 'college + building name',
    fields: [
      idField,
      { key: 'name', label: 'Building name', type: 'string', required: true, aliases: ['building', 'building name', 'site', 'block'] },
      { key: 'address', label: 'Address', type: 'nullable-string', required: false, aliases: ['address', 'street', 'location'] },
      { key: 'notes', label: 'Notes', type: 'nullable-string', required: false, aliases: ['notes', 'description'] },
    ],
  },
  {
    entity: 'rooms',
    label: 'Rooms',
    scope: 'campus',
    importable: true,
    order: 2,
    naturalKey: 'building + room code',
    fields: [
      idField,
      { key: 'buildingId', label: 'Building ID', type: 'string', required: true, aliases: ['building id', 'building', 'building code'] },
      { key: 'code', label: 'Room code', type: 'string', required: true, aliases: ['room code', 'room', 'room number', 'code'] },
      { key: 'name', label: 'Room name', type: 'nullable-string', required: false, aliases: ['room name', 'name'] },
      { key: 'floor', label: 'Floor', type: 'nullable-string', required: false, aliases: ['floor', 'level'] },
      { key: 'areaM2', label: 'Area (m2)', type: 'nullable-number', required: false, aliases: ['area', 'area m2', 'area (m2)', 'floor area'] },
      { key: 'capacity', label: 'Seat capacity', type: 'nullable-integer', required: false, aliases: ['capacity', 'seats', 'seat capacity', 'max occupancy'], note: 'Leave empty when unknown. Empty stays null, never zero.' },
      { key: 'condition', label: 'Condition', type: 'nullable-enum', required: false, enumValues: conditionEnum, aliases: ['condition', 'room condition'] },
      { key: 'notes', label: 'Notes', type: 'nullable-string', required: false, aliases: ['notes', 'description'] },
    ],
  },
  {
    entity: 'timetableSlots',
    label: 'Timetable bookings',
    scope: 'campus',
    importable: true,
    order: 3,
    naturalKey: 'room + start + end',
    fields: [
      idField,
      { key: 'roomId', label: 'Room ID', type: 'string', required: true, aliases: ['room id', 'room', 'room code'] },
      { key: 'startsAt', label: 'Starts at', type: 'iso-date', required: true, aliases: ['start', 'starts at', 'start time', 'from'] },
      { key: 'endsAt', label: 'Ends at', type: 'iso-date', required: true, aliases: ['end', 'ends at', 'end time', 'to'] },
      { key: 'activity', label: 'Activity', type: 'string', required: true, aliases: ['activity', 'module', 'class', 'event'] },
      { key: 'moduleCode', label: 'Module code', type: 'nullable-string', required: false, aliases: ['module code', 'course code'] },
      { key: 'expectedAttendance', label: 'Expected attendance', type: 'nullable-integer', required: false, aliases: ['expected attendance', 'demand', 'expected students', 'class size'], note: 'Demand evidence for capacity checks.' },
      { key: 'attendance', label: 'Actual attendance', type: 'nullable-integer', required: false, aliases: ['attendance', 'actual attendance', 'headcount', 'occupancy'], note: 'Occupancy evidence. Leave empty if not captured.' },
    ],
  },
  {
    entity: 'assets',
    label: 'Assets',
    scope: 'campus',
    importable: true,
    order: 4,
    naturalKey: 'college + asset name',
    fields: [
      idField,
      { key: 'buildingId', label: 'Building ID', type: 'nullable-string', required: false, aliases: ['building id', 'building', 'location'], note: 'Empty = campus-wide asset.' },
      { key: 'name', label: 'Asset name', type: 'string', required: true, aliases: ['asset', 'asset name', 'equipment', 'item'] },
      { key: 'category', label: 'Category', type: 'string', required: true, aliases: ['category', 'asset category', 'type'] },
      { key: 'installedAt', label: 'Installed at', type: 'nullable-iso-date', required: false, aliases: ['installed', 'install date', 'installed at'] },
      { key: 'condition', label: 'Condition', type: 'nullable-enum', required: false, enumValues: conditionEnum, aliases: ['condition', 'asset condition'] },
      { key: 'lastInspectedAt', label: 'Last inspected', type: 'nullable-iso-date', required: false, aliases: ['last inspected', 'last inspection', 'inspection date'] },
      { key: 'inspectionIntervalDays', label: 'Inspection interval (days)', type: 'nullable-integer', required: false, aliases: ['inspection interval', 'interval days', 'inspection frequency'] },
      { key: 'criticality', label: 'Criticality', type: 'nullable-enum', required: false, enumValues: severityEnum, aliases: ['criticality', 'priority', 'importance'] },
      { key: 'notes', label: 'Notes', type: 'nullable-string', required: false, aliases: ['notes', 'description'] },
    ],
  },
  {
    entity: 'inspections',
    label: 'Inspections',
    scope: 'campus',
    importable: true,
    order: 5,
    naturalKey: 'asset + scheduled date',
    fields: [
      idField,
      { key: 'assetId', label: 'Asset ID', type: 'string', required: true, aliases: ['asset id', 'asset'] },
      { key: 'scheduledFor', label: 'Scheduled for', type: 'iso-date', required: true, aliases: ['scheduled', 'scheduled for', 'due date', 'date'] },
      { key: 'completedAt', label: 'Completed at', type: 'nullable-iso-date', required: false, aliases: ['completed', 'completed at', 'inspection date'] },
      { key: 'inspectorUserId', label: 'Inspector user ID', type: 'nullable-string', required: false, aliases: ['inspector', 'inspector user id', 'staff id'] },
      { key: 'findings', label: 'Findings', type: 'nullable-string', required: false, aliases: ['findings', 'result', 'notes'] },
      { key: 'status', label: 'Status', type: 'enum', required: true, enumValues: inspectionStatusEnum, aliases: ['status', 'inspection status'] },
    ],
  },
  {
    entity: 'utilityMeters',
    label: 'Utility meters',
    scope: 'campus',
    importable: true,
    order: 6,
    naturalKey: 'building + meter label',
    fields: [
      idField,
      { key: 'buildingId', label: 'Building ID', type: 'string', required: true, aliases: ['building id', 'building'] },
      { key: 'utility', label: 'Utility', type: 'enum', required: true, enumValues: utilityEnum, aliases: ['utility', 'type', 'service'] },
      { key: 'unit', label: 'Unit', type: 'string', required: true, aliases: ['unit', 'measurement unit'] },
      { key: 'readingType', label: 'Reading type', type: 'enum', required: true, enumValues: readingTypeEnum, aliases: ['reading type', 'meter type', 'cumulative or interval'] },
      { key: 'label', label: 'Meter label', type: 'string', required: true, aliases: ['meter', 'meter label', 'meter name', 'name'] },
      { key: 'measurementType', label: 'Measurement type', type: 'enum', required: false, enumValues: ['measured', 'estimated'] as const, aliases: ['measurement type', 'measured or estimated', 'reading source'] },
    ],
  },
  {
    entity: 'utilityReadings',
    label: 'Utility readings',
    scope: 'campus',
    importable: true,
    order: 7,
    naturalKey: 'meter + reading date',
    fields: [
      idField,
      { key: 'meterId', label: 'Meter ID', type: 'string', required: true, aliases: ['meter id', 'meter'] },
      { key: 'readAt', label: 'Read at', type: 'iso-date', required: true, aliases: ['read at', 'reading date', 'date'] },
      { key: 'value', label: 'Value', type: 'nullable-number', required: false, aliases: ['value', 'reading', 'consumption', 'register'], note: 'Leave empty for a missing reading. It is preserved as a gap, never zero.' },
      { key: 'unit', label: 'Unit', type: 'string', required: true, aliases: ['unit'] },
      { key: 'note', label: 'Note', type: 'nullable-string', required: false, aliases: ['note', 'comment', 'remarks'] },
    ],
  },
  {
    entity: 'tariffs',
    label: 'Tariffs',
    scope: 'campus',
    importable: true,
    order: 8,
    naturalKey: 'college + utility + effective date',
    fields: [
      idField,
      { key: 'utility', label: 'Utility', type: 'enum', required: true, enumValues: utilityEnum, aliases: ['utility', 'type'] },
      { key: 'unit', label: 'Unit', type: 'string', required: true, aliases: ['unit'] },
      { key: 'currency', label: 'Currency', type: 'string', required: true, aliases: ['currency', 'currency code'] },
      { key: 'ratePerUnit', label: 'Rate per unit', type: 'nullable-number', required: false, aliases: ['rate', 'rate per unit', 'unit cost', 'price'] },
      { key: 'standingChargePerPeriod', label: 'Standing charge per period', type: 'nullable-number', required: false, aliases: ['standing charge', 'fixed charge'] },
      { key: 'effectiveFrom', label: 'Effective from', type: 'iso-date', required: true, aliases: ['effective from', 'start date', 'valid from'] },
      { key: 'note', label: 'Note', type: 'nullable-string', required: false, aliases: ['note', 'source', 'description'], note: 'Record the tariff source here so estimates are not mistaken for supplied prices.' },
    ],
  },
  {
    entity: 'complaints',
    label: 'Complaints',
    scope: 'campus',
    importable: true,
    order: 9,
    naturalKey: 'college + raised date + description',
    fields: [
      idField,
      { key: 'buildingId', label: 'Building ID', type: 'string', required: true, aliases: ['building id', 'building', 'block'] },
      { key: 'roomChoice', label: 'Room known', type: 'enum', required: true, enumValues: complaintRoomChoiceEnum, aliases: ['room choice', 'room known', 'room status'] },
      { key: 'roomId', label: 'Room ID', type: 'nullable-string', required: false, aliases: ['room id', 'room'] },
      { key: 'assetId', label: 'Asset ID', type: 'nullable-string', required: false, aliases: ['asset id', 'asset'] },
      { key: 'category', label: 'Category', type: 'string', required: true, aliases: ['category', 'issue category', 'type'] },
      { key: 'severity', label: 'Severity', type: 'enum', required: true, enumValues: severityEnum, aliases: ['severity', 'urgency', 'priority'] },
      { key: 'description', label: 'Description', type: 'string', required: true, aliases: ['description', 'complaint', 'details', 'issue'], note: 'At least 15 characters; say what is wrong, where and when.' },
      { key: 'status', label: 'Status', type: 'enum', required: true, enumValues: complaintStatusEnum, aliases: ['status', 'state'] },
      { key: 'raisedAt', label: 'Raised at', type: 'iso-date', required: true, aliases: ['raised at', 'reported at', 'date', 'created at'] },
      { key: 'resolvedAt', label: 'Resolved at', type: 'nullable-iso-date', required: false, aliases: ['resolved at', 'closed at', 'resolution date'] },
      { key: 'assignedToUserId', label: 'Assigned user ID', type: 'nullable-string', required: false, aliases: ['assigned to', 'assignee', 'assigned user id'] },
      { key: 'peopleAffected', label: 'People affected', type: 'nullable-integer', required: false, aliases: ['people affected', 'users affected', 'affected'] },
      { key: 'photoName', label: 'Photo file name', type: 'nullable-string', required: false, aliases: ['photo', 'photo name', 'image'] },
    ],
  },
  {
    entity: 'planOptions',
    label: 'Plan options',
    scope: 'campus',
    importable: true,
    order: 10,
    naturalKey: 'college + option title',
    fields: [
      idField,
      { key: 'title', label: 'Title', type: 'string', required: true, aliases: ['title', 'option', 'name'] },
      { key: 'optionType', label: 'Option type', type: 'enum', required: true, enumValues: optionTypeEnum, aliases: ['option type', 'type'] },
      { key: 'description', label: 'Description', type: 'string', required: true, aliases: ['description', 'details'] },
      { key: 'addressesFinding', label: 'Addresses finding', type: 'string', required: true, aliases: ['addresses finding', 'finding', 'target'] },
      { key: 'capitalCost', label: 'Capital cost', type: 'nullable-number', required: false, aliases: ['capital cost', 'capex'] },
      { key: 'annualCost', label: 'Annual cost', type: 'nullable-number', required: false, aliases: ['annual cost', 'running cost'] },
      { key: 'annualSavings', label: 'Annual savings', type: 'nullable-number', required: false, aliases: ['annual savings', 'savings'] },
      { key: 'capacityGainSeats', label: 'Capacity gain (seats)', type: 'nullable-integer', required: false, aliases: ['capacity gain', 'capacity gain seats'] },
      { key: 'demandReducedSeats', label: 'Demand reduction (seats)', type: 'nullable-integer', required: false, aliases: ['demand reduction', 'demand reduced seats'] },
      { key: 'disruptionDays', label: 'Disruption days', type: 'nullable-integer', required: false, aliases: ['disruption days', 'downtime'] },
      { key: 'implementationWeeks', label: 'Implementation weeks', type: 'nullable-integer', required: false, aliases: ['implementation weeks', 'duration'] },
      { key: 'assumptions', label: 'Assumptions', type: 'string', required: true, aliases: ['assumptions', 'premises'] },
      { key: 'risks', label: 'Risks', type: 'string', required: true, aliases: ['risks', 'trade-offs'] },
      { key: 'evidence', label: 'Evidence', type: 'string', required: true, aliases: ['evidence', 'basis'] },
    ],
  },
  {
    entity: 'urbanAssets',
    label: 'Public infrastructure assets',
    scope: 'public',
    importable: true,
    order: 11,
    naturalKey: 'category + location or name',
    fields: [
      idField,
      { key: 'category', label: 'Category', type: 'enum', required: true, enumValues: urbanAssetCategoryEnum, aliases: ['category', 'type'] },
      { key: 'name', label: 'Name', type: 'nullable-string', required: false, aliases: ['name', 'asset name'] },
      { key: 'locationLabel', label: 'Location', type: 'nullable-string', required: false, aliases: ['location', 'location label', 'place'] },
      { key: 'ownerAuthority', label: 'Responsible authority', type: 'nullable-string', required: false, aliases: ['authority', 'owner', 'responsible authority'] },
    ],
  },
  {
    entity: 'urbanIssues',
    label: 'Public infrastructure issues',
    scope: 'public',
    importable: true,
    order: 12,
    naturalKey: 'asset + reported date + category',
    fields: [
      idField,
      { key: 'urbanAssetId', label: 'Urban asset ID', type: 'nullable-string', required: false, aliases: ['urban asset id', 'asset id', 'asset'] },
      { key: 'category', label: 'Category', type: 'string', required: true, aliases: ['category', 'issue', 'type'] },
      { key: 'severity', label: 'Severity', type: 'enum', required: true, enumValues: severityEnum, aliases: ['severity', 'urgency'] },
      { key: 'description', label: 'Description', type: 'string', required: true, aliases: ['description', 'details', 'issue'] },
      { key: 'locationLabel', label: 'Location', type: 'string', required: true, aliases: ['location', 'location label', 'place'] },
      { key: 'authority', label: 'Responsible authority', type: 'nullable-string', required: false, aliases: ['authority', 'owner', 'responsible authority'] },
      { key: 'reportedAt', label: 'Reported at', type: 'iso-date', required: true, aliases: ['reported at', 'date', 'raised at'] },
      { key: 'status', label: 'Status', type: 'enum', required: true, enumValues: ['reported', 'in_progress', 'resolved', 'closed'] as const, aliases: ['status', 'state'] },
      { key: 'resolvedAt', label: 'Resolved at', type: 'nullable-iso-date', required: false, aliases: ['resolved at', 'closed at', 'resolution date'] },
      { key: 'note', label: 'Note', type: 'nullable-string', required: false, aliases: ['note', 'resolution note', 'update note'] },
      { key: 'photoName', label: 'Photo file name', type: 'nullable-string', required: false, aliases: ['photo', 'photo name'] },
    ],
  },
]

export const ENTITY_BY_NAME = new Map(ENTITY_SPECS.map((spec) => [spec.entity, spec]))

export const IMPORTABLE_ENTITIES = ENTITY_SPECS.filter((spec) => spec.importable)

/** Order matters for foreign keys: parents are processed before children. */
export const IMPORT_ORDER = [...IMPORTABLE_ENTITIES].sort((a, b) => a.order - b.order).map((s) => s.entity)

export const CAMPUS_ENTITIES = ENTITY_SPECS.filter((s) => s.scope === 'campus').map((s) => s.entity)
