/**
 * Approved synthetic seed for the server-backed MicroCity workspace.
 *
 * Every institution, person, measurement and incident here is INVENTED for
 * demonstration. The UI labels this base dataset SYNTHETIC. The external
 * workbook `smartcampus_test_data.xlsx` was not supplied, so none of these
 * records are claimed to reproduce it.
 */
import type {
  Asset,
  Building,
  Complaint,
  ComplaintUpdate,
  Decision,
  Inspection,
  PlanOption,
  Room,
  Tariff,
  TimetableSlot,
  NearbyAsset,
  UrbanAsset,
  UrbanIssue,
  UtilityMeter,
  UtilityReading,
} from '../src/domain/types.ts'

export const DEMO_DATASET_NAME = 'microcity-demo-2026-10'

export const SEED_PROVENANCE = {
  name: DEMO_DATASET_NAME,
  synthetic: true,
  generatedAt: '2026-10-24T01:00:00Z',
  generator:
    'MicroCity hand-authored demonstration dataset; no AI, no scraped or sensor data',
  source: null,
  license: 'Internal demonstration (synthetic) - not for public redistribution',
  notes:
    'Small fictional demonstration workspace for two colleges. Every institution, person, meter, ' +
    'complaint and measurement is invented. Missing readings are deliberate null gaps; one water ' +
    'meter reset is deliberate. Imported records are identified in the Data Centre import history.',
}

export interface SampleAccountSeed {
  id: string
  username: string
  displayName: string
  password: string
  role: 'admin' | 'estates' | 'maintenance' | 'faculty' | 'student'
  collegeId: string
}

export const SAMPLE_ACCOUNTS: SampleAccountSeed[] = [
  { id: 'usr-bv-admin', username: 'sample-admin', displayName: 'Sample Admin - Vidya Nagar', password: 'sample-admin-pass', role: 'admin', collegeId: 'clg-bv' },
  { id: 'usr-bv-estates', username: 'sample-estates', displayName: 'Sample Estates Officer', password: 'sample-estates-pass', role: 'estates', collegeId: 'clg-bv' },
  { id: 'usr-bv-maint', username: 'sample-maintenance', displayName: 'Sample Maintenance Technician', password: 'sample-maintenance-pass', role: 'maintenance', collegeId: 'clg-bv' },
  { id: 'usr-bv-faculty', username: 'sample-faculty', displayName: 'Sample Faculty Member', password: 'sample-faculty-pass', role: 'faculty', collegeId: 'clg-bv' },
  { id: 'usr-bv-student', username: 'sample-student', displayName: 'Sample Student', password: 'sample-student-pass', role: 'student', collegeId: 'clg-bv' },
  { id: 'usr-fd-admin', username: 'sample-fd-admin', displayName: 'Sample Admin - Seva Nagar', password: 'sample-fd-admin-pass', role: 'admin', collegeId: 'clg-fd' },
  { id: 'usr-fd-estates', username: 'sample-fd-estates', displayName: 'Sample Estates Officer - Seva Nagar', password: 'sample-fd-estates-pass', role: 'estates', collegeId: 'clg-fd' },
  { id: 'usr-fd-student', username: 'sample-fd-student', displayName: 'Sample Student - Seva Nagar', password: 'sample-fd-student-pass', role: 'student', collegeId: 'clg-fd' },
]

export const SEED_COLLEGES = [
  { id: 'clg-bv', name: 'Vidya Nagar College (fictional)', code: 'VIDYA-NAGAR' },
  { id: 'clg-fd', name: 'Seva Nagar College (fictional)', code: 'SEVA-NAGAR' },
]

export const SEED_NEARBY_ASSETS: NearbyAsset[] = [
  { id: 'near-bv-light', collegeId: 'clg-bv', type: 'streetlight', locationDescription: 'Approach road near college gate (Illustrative)', distanceMetres: 25, distanceBasis: 'estimated', condition: 'fair', dailyUsers: 120, usersMethod: 'Illustrative placeholder for a daily-use estimate; no observation was made.', responsibleAuthority: 'Local ward office (Illustrative)', basis: 'illustrative' },
  { id: 'near-bv-footpath', collegeId: 'clg-bv', type: 'footpath', locationDescription: 'Footpath section near college gate (Illustrative)', distanceMetres: 40, distanceBasis: 'estimated', condition: 'poor', dailyUsers: 240, usersMethod: 'Illustrative placeholder for a daily-use estimate; no observation was made.', responsibleAuthority: 'Local ward office (Illustrative)', basis: 'illustrative' },
  { id: 'near-bv-water', collegeId: 'clg-bv', type: 'drinking_water', locationDescription: 'Water point near college gate (Illustrative)', distanceMetres: 10, distanceBasis: 'estimated', condition: 'good', dailyUsers: null, usersMethod: null, responsibleAuthority: 'Local ward office (Illustrative)', basis: 'illustrative' },
]

export const SEED_BUILDINGS: Building[] = [
  { id: 'bld-bv-main', collegeId: 'clg-bv', name: 'Main Teaching Hall (fictional)', address: 'Approach road near college gate (synthetic)', notes: null },
  { id: 'bld-bv-workshop', collegeId: 'clg-bv', name: 'Riverside Workshop (fictional)', address: null, notes: 'Workshop block with separate electricity meter.' },
  { id: 'bld-bv-library', collegeId: 'clg-bv', name: 'Library Block (fictional)', address: 'Library block, near college gate (synthetic)', notes: null },
  { id: 'bld-fd-court', collegeId: 'clg-fd', name: 'Seva Nagar Academic Block (fictional)', address: 'Campus approach road (synthetic)', notes: null },
]

export const SEED_ROOMS: Room[] = [
  { id: 'rm-bv-101', collegeId: 'clg-bv', buildingId: 'bld-bv-main', code: '1.01', name: 'Lecture room 1.01', floor: '1', areaM2: 62.4, capacity: 30, condition: 'fair', notes: null },
  { id: 'rm-bv-102', collegeId: 'clg-bv', buildingId: 'bld-bv-main', code: '1.02', name: 'Seminar room 1.02', floor: '1', areaM2: 48, capacity: 24, condition: 'good', notes: null },
  { id: 'rm-bv-201', collegeId: 'clg-bv', buildingId: 'bld-bv-main', code: '2.01', name: 'HVAC lecture room 2.01', floor: '2', areaM2: 95, capacity: 60, condition: 'poor', notes: 'Ventilation complaints recorded in 2026.' },
  { id: 'rm-bv-ws1', collegeId: 'clg-bv', buildingId: 'bld-bv-workshop', code: 'WS-1', name: 'Welding bay', floor: 'Ground', areaM2: 210, capacity: null, condition: 'fair', notes: 'Capacity not recorded - preserved as unknown.' },
  { id: 'rm-bv-l1', collegeId: 'clg-bv', buildingId: 'bld-bv-library', code: 'L1', name: 'Library seminar room', floor: '1', areaM2: 34, capacity: 18, condition: 'good', notes: null },
  { id: 'rm-fd-f1', collegeId: 'clg-fd', buildingId: 'bld-fd-court', code: 'F1', name: 'Lecture room F1', floor: '1', areaM2: 55, capacity: 28, condition: 'fair', notes: null },
  { id: 'rm-fd-f2', collegeId: 'clg-fd', buildingId: 'bld-fd-court', code: 'F2', name: 'Seminar room F2', floor: '1', areaM2: 40, capacity: 20, condition: 'good', notes: null },
]

export const SEED_TIMETABLE: TimetableSlot[] = [
  { id: 'tlt-bv-1', collegeId: 'clg-bv', roomId: 'rm-bv-101', startsAt: '2026-10-05T09:00:00Z', endsAt: '2026-10-05T10:30:00Z', activity: 'Foundations of BIM (invented module)', moduleCode: 'BIM101', expectedAttendance: 42, attendance: 39 },
  { id: 'tlt-bv-2', collegeId: 'clg-bv', roomId: 'rm-bv-101', startsAt: '2026-10-05T11:00:00Z', endsAt: '2026-10-05T12:30:00Z', activity: 'Surveying Basics (invented module)', moduleCode: 'SUR110', expectedAttendance: 28, attendance: 22 },
  { id: 'tlt-bv-3', collegeId: 'clg-bv', roomId: 'rm-bv-201', startsAt: '2026-10-06T14:00:00Z', endsAt: '2026-10-06T16:00:00Z', activity: 'HVAC Systems lecture (invented module)', moduleCode: 'HVC201', expectedAttendance: 74, attendance: null },
  { id: 'tlt-bv-4', collegeId: 'clg-bv', roomId: 'rm-bv-201', startsAt: '2026-10-06T15:00:00Z', endsAt: '2026-10-06T17:00:00Z', activity: 'HVAC Lab (invented session)', moduleCode: 'HVC201L', expectedAttendance: 40, attendance: null },
  { id: 'tlt-bv-5', collegeId: 'clg-bv', roomId: 'rm-bv-ws1', startsAt: '2026-10-07T10:00:00Z', endsAt: '2026-10-07T12:00:00Z', activity: 'Welding practice (invented session)', moduleCode: 'WLD140', expectedAttendance: 14, attendance: 12 },
  { id: 'tlt-bv-6', collegeId: 'clg-bv', roomId: 'rm-bv-102', startsAt: '2026-10-08T09:00:00Z', endsAt: '2026-10-08T11:00:00Z', activity: 'Energy Reporting tutorial (invented module)', moduleCode: 'ENR120', expectedAttendance: 20, attendance: 6 },
  { id: 'tlt-bv-7', collegeId: 'clg-bv', roomId: 'rm-bv-l1', startsAt: '2026-10-09T13:00:00Z', endsAt: '2026-10-09T14:00:00Z', activity: 'Research seminar (invented session)', moduleCode: null, expectedAttendance: 16, attendance: 15 },
  { id: 'tlt-fd-1', collegeId: 'clg-fd', roomId: 'rm-fd-f1', startsAt: '2026-10-08T09:00:00Z', endsAt: '2026-10-08T10:00:00Z', activity: 'Intro to Energy Reporting (invented module)', moduleCode: 'ENR101', expectedAttendance: 34, attendance: 31 },
]

export const SEED_METERS: UtilityMeter[] = [
  { id: 'mtr-bv-main-e1', collegeId: 'clg-bv', buildingId: 'bld-bv-main', utility: 'electricity', unit: 'kWh', readingType: 'interval', label: 'Main hall electricity' },
  { id: 'mtr-bv-main-w1', collegeId: 'clg-bv', buildingId: 'bld-bv-main', utility: 'water', unit: 'm3', readingType: 'cumulative', label: 'Main hall water' },
  { id: 'mtr-bv-ws-e1', collegeId: 'clg-bv', buildingId: 'bld-bv-workshop', utility: 'electricity', unit: 'kWh', readingType: 'interval', label: 'Workshop electricity' },
  { id: 'mtr-bv-lib-e1', collegeId: 'clg-bv', buildingId: 'bld-bv-library', utility: 'electricity', unit: 'kWh', readingType: 'interval', label: 'Library electricity' },
  { id: 'mtr-fd-e1', collegeId: 'clg-fd', buildingId: 'bld-fd-court', utility: 'electricity', unit: 'kWh', readingType: 'interval', label: 'Academic block electricity' },
  { id: 'mtr-fd-w1', collegeId: 'clg-fd', buildingId: 'bld-fd-court', utility: 'water', unit: 'm3', readingType: 'cumulative', label: 'Academic block water' },
]

/** Monthly values. May 2026 main-hall electricity is null: the meter was offline. */
export const SEED_READINGS: UtilityReading[] = [
  { id: 'rea-bv-e-01', collegeId: 'clg-bv', meterId: 'mtr-bv-main-e1', readAt: '2026-01-01T00:00:00Z', value: 9120, unit: 'kWh', note: null },
  { id: 'rea-bv-e-02', collegeId: 'clg-bv', meterId: 'mtr-bv-main-e1', readAt: '2026-02-01T00:00:00Z', value: 8760, unit: 'kWh', note: null },
  { id: 'rea-bv-e-03', collegeId: 'clg-bv', meterId: 'mtr-bv-main-e1', readAt: '2026-03-01T00:00:00Z', value: 9480, unit: 'kWh', note: null },
  { id: 'rea-bv-e-04', collegeId: 'clg-bv', meterId: 'mtr-bv-main-e1', readAt: '2026-04-01T00:00:00Z', value: 8340, unit: 'kWh', note: null },
  { id: 'rea-bv-e-05', collegeId: 'clg-bv', meterId: 'mtr-bv-main-e1', readAt: '2026-05-01T00:00:00Z', value: null, unit: 'kWh', note: 'Meter offline - deliberate missing reading (synthetic)' },
  { id: 'rea-bv-e-06', collegeId: 'clg-bv', meterId: 'mtr-bv-main-e1', readAt: '2026-06-01T00:00:00Z', value: 7980, unit: 'kWh', note: null },
  { id: 'rea-bv-e-07', collegeId: 'clg-bv', meterId: 'mtr-bv-main-e1', readAt: '2026-07-01T00:00:00Z', value: 8100, unit: 'kWh', note: null },
  { id: 'rea-bv-e-08', collegeId: 'clg-bv', meterId: 'mtr-bv-main-e1', readAt: '2026-08-01T00:00:00Z', value: 8260, unit: 'kWh', note: null },
  { id: 'rea-bv-e-09', collegeId: 'clg-bv', meterId: 'mtr-bv-main-e1', readAt: '2026-09-01T00:00:00Z', value: 13980, unit: 'kWh', note: 'Synthetic spike: nearly 70% above recent baseline' },

  { id: 'rea-bv-w-01', collegeId: 'clg-bv', meterId: 'mtr-bv-main-w1', readAt: '2026-01-01T00:00:00Z', value: 42100, unit: 'm3', note: null },
  { id: 'rea-bv-w-02', collegeId: 'clg-bv', meterId: 'mtr-bv-main-w1', readAt: '2026-02-01T00:00:00Z', value: 42314, unit: 'm3', note: null },
  { id: 'rea-bv-w-03', collegeId: 'clg-bv', meterId: 'mtr-bv-main-w1', readAt: '2026-03-01T00:00:00Z', value: 42512, unit: 'm3', note: null },
  { id: 'rea-bv-w-04', collegeId: 'clg-bv', meterId: 'mtr-bv-main-w1', readAt: '2026-04-01T00:00:00Z', value: 42718, unit: 'm3', note: null },
  { id: 'rea-bv-w-05', collegeId: 'clg-bv', meterId: 'mtr-bv-main-w1', readAt: '2026-05-01T00:00:00Z', value: 42906, unit: 'm3', note: null },
  { id: 'rea-bv-w-06', collegeId: 'clg-bv', meterId: 'mtr-bv-main-w1', readAt: '2026-06-01T00:00:00Z', value: 43084, unit: 'm3', note: null },
  { id: 'rea-bv-w-07', collegeId: 'clg-bv', meterId: 'mtr-bv-main-w1', readAt: '2026-07-01T00:00:00Z', value: 43255, unit: 'm3', note: null },
  { id: 'rea-bv-w-08', collegeId: 'clg-bv', meterId: 'mtr-bv-main-w1', readAt: '2026-08-01T00:00:00Z', value: 43795, unit: 'm3', note: 'Synthetic high-consumption month' },
  { id: 'rea-bv-w-09', collegeId: 'clg-bv', meterId: 'mtr-bv-main-w1', readAt: '2026-09-01T00:00:00Z', value: 43985, unit: 'm3', note: null },
  { id: 'rea-bv-w-10', collegeId: 'clg-bv', meterId: 'mtr-bv-main-w1', readAt: '2026-10-01T00:00:00Z', value: 15, unit: 'm3', note: 'Meter replaced - register reset (synthetic)' },

  { id: 'rea-bv-ws-01', collegeId: 'clg-bv', meterId: 'mtr-bv-ws-e1', readAt: '2026-06-01T00:00:00Z', value: 6120, unit: 'kWh', note: null },
  { id: 'rea-bv-ws-02', collegeId: 'clg-bv', meterId: 'mtr-bv-ws-e1', readAt: '2026-07-01T00:00:00Z', value: 5980, unit: 'kWh', note: null },
  { id: 'rea-bv-ws-03', collegeId: 'clg-bv', meterId: 'mtr-bv-ws-e1', readAt: '2026-08-01T00:00:00Z', value: 6460, unit: 'kWh', note: null },
  { id: 'rea-bv-ws-04', collegeId: 'clg-bv', meterId: 'mtr-bv-ws-e1', readAt: '2026-09-01T00:00:00Z', value: 6840, unit: 'kWh', note: null },

  { id: 'rea-bv-lib-01', collegeId: 'clg-bv', meterId: 'mtr-bv-lib-e1', readAt: '2026-07-01T00:00:00Z', value: 2140, unit: 'kWh', note: null },
  { id: 'rea-bv-lib-02', collegeId: 'clg-bv', meterId: 'mtr-bv-lib-e1', readAt: '2026-08-01T00:00:00Z', value: 2080, unit: 'kWh', note: null },
  { id: 'rea-bv-lib-03', collegeId: 'clg-bv', meterId: 'mtr-bv-lib-e1', readAt: '2026-09-01T00:00:00Z', value: 2210, unit: 'kWh', note: null },

  { id: 'rea-fd-e-01', collegeId: 'clg-fd', meterId: 'mtr-fd-e1', readAt: '2026-07-01T00:00:00Z', value: 4230, unit: 'kWh', note: null },
  { id: 'rea-fd-e-02', collegeId: 'clg-fd', meterId: 'mtr-fd-e1', readAt: '2026-08-01T00:00:00Z', value: 4010, unit: 'kWh', note: null },
  { id: 'rea-fd-e-03', collegeId: 'clg-fd', meterId: 'mtr-fd-e1', readAt: '2026-09-01T00:00:00Z', value: 4390, unit: 'kWh', note: null },
  { id: 'rea-fd-w-01', collegeId: 'clg-fd', meterId: 'mtr-fd-w1', readAt: '2026-08-01T00:00:00Z', value: 12050, unit: 'm3', note: null },
  { id: 'rea-fd-w-02', collegeId: 'clg-fd', meterId: 'mtr-fd-w1', readAt: '2026-09-01T00:00:00Z', value: 12240, unit: 'm3', note: null },
]

export const SEED_TARIFF_PLACEHOLDER_NOTE =
  'Placeholder — enter the rate from your bill. Not a real tariff.'

/**
 * Tariffs are intentionally blank. The seed makes no claim about any real
 * supplier price; an administrator must enter rates from an actual bill.
 */
export const SEED_TARIFFS: Tariff[] = [
  { id: 'trf-bv-e', collegeId: 'clg-bv', utility: 'electricity', unit: 'kWh', currency: 'INR', ratePerUnit: null, standingChargePerPeriod: null, effectiveFrom: '2026-01-01', note: SEED_TARIFF_PLACEHOLDER_NOTE },
  { id: 'trf-bv-w', collegeId: 'clg-bv', utility: 'water', unit: 'm3', currency: 'INR', ratePerUnit: null, standingChargePerPeriod: null, effectiveFrom: '2026-01-01', note: SEED_TARIFF_PLACEHOLDER_NOTE },
  { id: 'trf-fd-e', collegeId: 'clg-fd', utility: 'electricity', unit: 'kWh', currency: 'INR', ratePerUnit: null, standingChargePerPeriod: null, effectiveFrom: '2026-01-01', note: SEED_TARIFF_PLACEHOLDER_NOTE },
  { id: 'trf-fd-w', collegeId: 'clg-fd', utility: 'water', unit: 'm3', currency: 'INR', ratePerUnit: null, standingChargePerPeriod: null, effectiveFrom: '2026-01-01', note: SEED_TARIFF_PLACEHOLDER_NOTE },
]

export const SEED_ASSETS: Asset[] = [
  { id: 'ast-bv-boiler', collegeId: 'clg-bv', buildingId: 'bld-bv-main', name: 'Main gas boiler (fictional)', category: 'heating', installedAt: '2018-03-14', condition: 'good', lastInspectedAt: '2025-10-01', inspectionIntervalDays: 365, criticality: 'high', notes: null },
  { id: 'ast-bv-ahu', collegeId: 'clg-bv', buildingId: 'bld-bv-main', name: 'Rooftop air handling unit (fictional)', category: 'ventilation', installedAt: '2019-06-20', condition: 'fair', lastInspectedAt: '2026-08-01', inspectionIntervalDays: 180, criticality: 'high', notes: 'Repeat filter complaints recorded.' },
  { id: 'ast-bv-welding', collegeId: 'clg-bv', buildingId: 'bld-bv-workshop', name: 'Welding rig set (fictional)', category: 'workshop', installedAt: '2015-11-02', condition: 'poor', lastInspectedAt: '2026-03-10', inspectionIntervalDays: 90, criticality: 'high', notes: null },
  { id: 'ast-bv-cart', collegeId: 'clg-bv', buildingId: null, name: 'Grounds utility cart (fictional)', category: 'grounds', installedAt: '2021-05-10', condition: null, lastInspectedAt: null, inspectionIntervalDays: null, criticality: 'low', notes: 'Condition and inspection regime unrecorded.' },
  { id: 'ast-bv-network', collegeId: 'clg-bv', buildingId: 'bld-bv-main', name: 'Core network switch (fictional)', category: 'IT / network', installedAt: '2022-09-01', condition: 'good', lastInspectedAt: '2026-09-15', inspectionIntervalDays: 365, criticality: 'critical', notes: null },
  { id: 'ast-bv-lift', collegeId: 'clg-bv', buildingId: 'bld-bv-main', name: 'Passenger lift (fictional)', category: 'electrical', installedAt: '2016-01-20', condition: 'fair', lastInspectedAt: '2026-05-01', inspectionIntervalDays: 180, criticality: 'critical', notes: null },
  { id: 'ast-fd-hoist', collegeId: 'clg-fd', buildingId: 'bld-fd-court', name: 'Sidewall hoist (fictional)', category: 'workshop', installedAt: '2020-02-28', condition: 'fair', lastInspectedAt: '2026-05-01', inspectionIntervalDays: 180, criticality: 'high', notes: null },
  { id: 'ast-fd-boiler', collegeId: 'clg-fd', buildingId: 'bld-fd-court', name: 'Academic block boiler (fictional)', category: 'heating', installedAt: '2017-11-15', condition: 'good', lastInspectedAt: '2026-09-01', inspectionIntervalDays: 365, criticality: 'high', notes: null },
]

export const SEED_INSPECTIONS: Inspection[] = [
  { id: 'ins-bv-boiler-oct', collegeId: 'clg-bv', assetId: 'ast-bv-boiler', scheduledFor: '2026-10-20T09:00:00Z', completedAt: null, inspectorUserId: 'usr-bv-maint', findings: null, status: 'scheduled' },
  { id: 'ins-bv-ahu-aug', collegeId: 'clg-bv', assetId: 'ast-bv-ahu', scheduledFor: '2026-08-01T09:00:00Z', completedAt: '2026-08-01T10:30:00Z', inspectorUserId: 'usr-bv-maint', findings: 'Filters replaced; belt tension checked.', status: 'completed' },
  { id: 'ins-bv-welding-nov', collegeId: 'clg-bv', assetId: 'ast-bv-welding', scheduledFor: '2026-11-02T10:00:00Z', completedAt: null, inspectorUserId: 'usr-bv-maint', findings: null, status: 'scheduled' },
  { id: 'ins-bv-network-sep', collegeId: 'clg-bv', assetId: 'ast-bv-network', scheduledFor: '2026-09-15T14:00:00Z', completedAt: '2026-09-15T15:00:00Z', inspectorUserId: 'usr-bv-maint', findings: 'No faults; firmware up to date.', status: 'completed' },
  { id: 'ins-fd-hoist-oct', collegeId: 'clg-fd', assetId: 'ast-fd-hoist', scheduledFor: '2026-10-27T09:00:00Z', completedAt: null, inspectorUserId: null, findings: null, status: 'scheduled' },
]

export const SEED_COMPLAINTS: Complaint[] = [
  {
    id: 'cmp-bv-projector', collegeId: 'clg-bv', reporterId: 'usr-bv-faculty', buildingId: 'bld-bv-main', roomChoice: 'room', roomId: 'rm-bv-101', assetId: null,
    category: 'IT / network', severity: 'high', description: 'Projector mount is loose above the teaching wall in room 1.01. (invented complaint)',
    status: 'open', raisedAt: '2026-10-07T08:40:00Z', resolvedAt: null, assignedToUserId: null,
    peopleAffected: 120, photoName: null, photoDataUrl: null,
  },
  {
    id: 'cmp-bv-welding', collegeId: 'clg-bv', reporterId: 'usr-bv-faculty', buildingId: 'bld-bv-workshop', roomChoice: 'not_sure', roomId: null, assetId: 'ast-bv-welding',
    category: 'Electrical', severity: 'critical', description: 'Welding rig cuts out under load and trips the workshop circuit. (invented complaint)',
    status: 'in_progress', raisedAt: '2026-10-05T09:15:00Z', resolvedAt: null, assignedToUserId: 'usr-bv-maint',
    peopleAffected: 25, photoName: null, photoDataUrl: null,
  },
  {
    id: 'cmp-bv-ahu-repeat', collegeId: 'clg-bv', reporterId: 'usr-bv-estates', buildingId: 'bld-bv-main', roomChoice: 'not_sure', roomId: null, assetId: 'ast-bv-ahu',
    category: 'Heating / cooling', severity: 'medium', description: 'AHU filters blocked again; airflow in lecture rooms is poor. (invented complaint)',
    status: 'open', raisedAt: '2026-10-18T11:20:00Z', resolvedAt: null, assignedToUserId: null,
    peopleAffected: 60, photoName: null, photoDataUrl: null,
  },
  {
    id: 'cmp-bv-ahu-aug', collegeId: 'clg-bv', reporterId: 'usr-bv-estates', buildingId: 'bld-bv-main', roomChoice: 'not_sure', roomId: null, assetId: 'ast-bv-ahu',
    category: 'Heating / cooling', severity: 'medium', description: 'AHU filter replacement requested. (invented complaint)',
    status: 'resolved', raisedAt: '2026-08-05T10:00:00Z', resolvedAt: '2026-08-06T15:00:00Z', assignedToUserId: 'usr-bv-maint',
    peopleAffected: 60, photoName: null, photoDataUrl: null,
  },
  {
    id: 'cmp-bv-ahu-sep', collegeId: 'clg-bv', reporterId: 'usr-bv-faculty', buildingId: 'bld-bv-main', roomChoice: 'not_sure', roomId: null, assetId: 'ast-bv-ahu',
    category: 'Heating / cooling', severity: 'medium', description: 'Poor airflow from ceiling vents in rooms 1.01 and 2.01. (invented complaint)',
    status: 'resolved', raisedAt: '2026-09-02T09:30:00Z', resolvedAt: '2026-09-04T12:00:00Z', assignedToUserId: 'usr-bv-maint',
    peopleAffected: 90, photoName: null, photoDataUrl: null,
  },
  {
    id: 'cmp-bv-lighting', collegeId: 'clg-bv', reporterId: 'usr-bv-student', buildingId: 'bld-bv-main', roomChoice: 'not_sure', roomId: null, assetId: null,
    category: 'Electrical', severity: 'medium', description: 'Corridor lighting is dim near stairwell B. (invented complaint)',
    status: 'open', raisedAt: '2026-10-12T10:30:00Z', resolvedAt: null, assignedToUserId: null,
    peopleAffected: 40, photoName: null, photoDataUrl: null,
  },
  {
    id: 'cmp-bv-window', collegeId: 'clg-bv', reporterId: 'usr-bv-student', buildingId: 'bld-bv-main', roomChoice: 'room', roomId: 'rm-bv-102', assetId: null,
    category: 'Room fabric', severity: 'low', description: 'Window latch in room 1.02 will not close fully. (invented complaint)',
    status: 'resolved', raisedAt: '2026-10-09T14:10:00Z', resolvedAt: '2026-10-10T09:00:00Z', assignedToUserId: 'usr-bv-maint',
    peopleAffected: 20, photoName: null, photoDataUrl: null,
  },
  {
    id: 'cmp-bv-leak', collegeId: 'clg-bv', reporterId: 'usr-bv-faculty', buildingId: 'bld-bv-main', roomChoice: 'room', roomId: 'rm-bv-102', assetId: null,
    category: 'Plumbing', severity: 'high', description: 'Water pooling under the radiator in room 1.02 again. (invented complaint)',
    status: 'open', raisedAt: '2026-10-21T08:00:00Z', resolvedAt: null, assignedToUserId: null,
    peopleAffected: 30, photoName: null, photoDataUrl: null,
  },
  {
    id: 'cmp-bv-leak-sep', collegeId: 'clg-bv', reporterId: 'usr-bv-estates', buildingId: 'bld-bv-main', roomChoice: 'room', roomId: 'rm-bv-102', assetId: null,
    category: 'Plumbing', severity: 'high', description: 'Radiator valve leaking in room 1.02. (invented complaint)',
    status: 'resolved', raisedAt: '2026-09-20T09:00:00Z', resolvedAt: '2026-09-21T16:00:00Z', assignedToUserId: 'usr-bv-maint',
    peopleAffected: 20, photoName: null, photoDataUrl: null,
  },
  {
    id: 'cmp-fd-valve', collegeId: 'clg-fd', reporterId: 'usr-fd-student', buildingId: 'bld-fd-court', roomChoice: 'room', roomId: 'rm-fd-f2', assetId: null,
    category: 'Heating / cooling', severity: 'medium', description: 'Heating valve is stuck on in room F2. (invented complaint)',
    status: 'open', raisedAt: '2026-10-15T11:00:00Z', resolvedAt: null, assignedToUserId: null,
    peopleAffected: 18, photoName: null, photoDataUrl: null,
  },
]

export const SEED_COMPLAINT_UPDATES: ComplaintUpdate[] = [
  { id: 'cupd-bv-1', collegeId: 'clg-bv', complaintId: 'cmp-bv-welding', at: '2026-10-05T09:15:00Z', actorId: 'usr-bv-faculty', actorName: 'Sample Faculty Member', kind: 'created', note: 'Complaint submitted.', fromStatus: null, toStatus: 'open' },
  { id: 'cupd-bv-2', collegeId: 'clg-bv', complaintId: 'cmp-bv-welding', at: '2026-10-05T13:00:00Z', actorId: 'usr-bv-estates', actorName: 'Sample Estates Officer', kind: 'assigned', note: 'Assigned to maintenance technician.', fromStatus: null, toStatus: null },
  { id: 'cupd-bv-3', collegeId: 'clg-bv', complaintId: 'cmp-bv-welding', at: '2026-10-06T08:30:00Z', actorId: 'usr-bv-maint', actorName: 'Sample Maintenance Technician', kind: 'status', note: 'Inspection started; isolation test scheduled.', fromStatus: 'open', toStatus: 'in_progress' },
  { id: 'cupd-bv-4', collegeId: 'clg-bv', complaintId: 'cmp-bv-ahu-repeat', at: '2026-10-18T11:20:00Z', actorId: 'usr-bv-estates', actorName: 'Sample Estates Officer', kind: 'created', note: 'Complaint submitted.', fromStatus: null, toStatus: 'open' },
  { id: 'cupd-bv-5', collegeId: 'clg-bv', complaintId: 'cmp-bv-window', at: '2026-10-09T14:10:00Z', actorId: 'usr-bv-student', actorName: 'Sample Student', kind: 'created', note: 'Complaint submitted.', fromStatus: null, toStatus: 'open' },
  { id: 'cupd-bv-6', collegeId: 'clg-bv', complaintId: 'cmp-bv-window', at: '2026-10-10T09:00:00Z', actorId: 'usr-bv-maint', actorName: 'Sample Maintenance Technician', kind: 'status', note: 'Latch repaired.', fromStatus: 'in_progress', toStatus: 'resolved' },
  { id: 'cupd-bv-7', collegeId: 'clg-bv', complaintId: 'cmp-bv-leak', at: '2026-10-21T08:00:00Z', actorId: 'usr-bv-faculty', actorName: 'Sample Faculty Member', kind: 'created', note: 'Complaint submitted.', fromStatus: null, toStatus: 'open' },
  { id: 'cupd-fd-1', collegeId: 'clg-fd', complaintId: 'cmp-fd-valve', at: '2026-10-15T11:00:00Z', actorId: 'usr-fd-student', actorName: 'Sample Student - Seva Nagar', kind: 'created', note: 'Complaint submitted.', fromStatus: null, toStatus: 'open' },
]

export const SEED_PLAN_OPTIONS: PlanOption[] = [
  {
    id: 'opt-bv-retime', collegeId: 'clg-bv', title: 'Re-time the largest HVAC sessions', optionType: 'timetable',
    description: 'Split the 74-seat HVAC lecture into two sittings and use seminar room 1.02 for the overflow group.', addressesFinding: 'capacity-rm-bv-201',
    capitalCost: 0, annualCost: 0, annualSavings: null, capacityGainSeats: 0, demandReducedSeats: 20,
    disruptionDays: 2, implementationWeeks: 1,
    assumptions: 'The same teacher can run two sittings; room 1.02 is free at the proposed time. Peak demand falls by 20 seats.',
    risks: 'Two sittings increase staff contact time; students may have timetable clashes.',
    evidence: 'Timetable record tlt-bv-3 expects 74 students in a 60-seat room; tlt-bv-4 overlaps it by 60 minutes.',
  },
  {
    id: 'opt-bv-room', collegeId: 'clg-bv', title: 'Create a 30-seat teaching room', optionType: 'capacity',
    description: 'Convert the underused library store into a 30-seat flat-floor teaching room.', addressesFinding: 'capacity-rm-bv-201',
    capitalCost: 85000, annualCost: 4200, annualSavings: null, capacityGainSeats: 30, demandReducedSeats: 0,
    disruptionDays: 90, implementationWeeks: 26,
    assumptions: 'Planning permission is granted, the store is genuinely free, and the cost estimate is supplied by estates rather than predicted by MicroCity.',
    risks: 'Capital funding may not be available; works disrupt the library during term.',
    evidence: 'Largest observed session demand is 74 seats against 60 seats of capacity in room 2.01.',
  },
  {
    id: 'opt-bv-sensor', collegeId: 'clg-bv', title: 'Install sub-metering on workshop circuits', optionType: 'maintenance',
    description: 'Add sub-meters to the welding and workshop circuits to separate equipment load from building base load.', addressesFinding: 'utility-mtr-bv-ws-e1',
    capitalCost: 4200, annualCost: 350, annualSavings: null, capacityGainSeats: null, demandReducedSeats: null,
    disruptionDays: 1, implementationWeeks: 4,
    assumptions: 'Metering can be installed without a shutdown; no savings are claimed without an agreed baseline.',
    risks: 'Sub-metering diagnoses consumption but does not itself reduce it.',
    evidence: 'Workshop electricity is currently measured by one interval meter with no circuit-level breakdown.',
  },
]

export const SEED_DECISIONS: Decision[] = [
  {
    id: 'dec-bv-retime', collegeId: 'clg-bv', optionId: 'opt-bv-retime', title: 'Approve re-timing for HVAC sessions', status: 'approved',
    decidedByUserId: 'usr-bv-admin', decidedAt: '2026-10-20T15:00:00Z', ownerUserId: 'usr-bv-estates',
    followUp: 'Publish the revised timetable before 2026-11-10 and confirm room 1.02 availability.',
    notes: 'Approved as a low-cost first step. Capital option remains under review.', createdAt: '2026-10-19T10:00:00Z',
  },
  {
    id: 'dec-bv-room', collegeId: 'clg-bv', optionId: 'opt-bv-room', title: 'Consider 30-seat room conversion', status: 'proposed',
    decidedByUserId: null, decidedAt: null, ownerUserId: null,
    followUp: 'Estates to validate cost and planning constraints.', notes: 'Awaiting decision.', createdAt: '2026-10-19T10:05:00Z',
  },
]

export const SEED_URBAN_ASSETS: UrbanAsset[] = [
  { id: 'ua-1', category: 'street_lighting', name: 'Lighting column L-104 (fictional)', locationLabel: 'Approach road near college gate', ownerAuthority: 'Local ward office (synthetic)' },
  { id: 'ua-2', category: 'footway', name: 'Kerb and paving section (fictional)', locationLabel: 'Footpath near college gate', ownerAuthority: 'Local ward office (synthetic)' },
  { id: 'ua-3', category: 'bus_stop', name: 'Campus bus stop (fictional)', locationLabel: 'Bus stop near college gate', ownerAuthority: 'Local transport office (synthetic)' },
  { id: 'ua-4', category: 'cycle_path', name: 'Cycle path near campus (fictional)', locationLabel: 'Cycle path near campus', ownerAuthority: 'Local ward office (synthetic)' },
  { id: 'ua-5', category: 'drainage', name: 'Storm drain near college gate (fictional)', locationLabel: 'College gate entrance', ownerAuthority: 'Local ward office (synthetic)' },
]

export const SEED_URBAN_ISSUES: UrbanIssue[] = [
  { id: 'ui-1', urbanAssetId: 'ua-1', reporterId: 'usr-bv-student', category: 'Damaged light', severity: 'medium', description: 'Two of four lamps are out after a storm. (invented incident)', locationLabel: 'Approach road near college gate', authority: 'Local ward office (synthetic)', reportedAt: '2026-10-09T18:30:00Z', status: 'reported', resolvedAt: null, photoName: null, photoDataUrl: null },
  { id: 'ui-2', urbanAssetId: 'ua-2', reporterId: 'usr-bv-faculty', category: 'Trip hazard', severity: 'critical', description: 'Raised paving slab near the pedestrian crossing. (invented incident)', locationLabel: 'Footpath near college gate', authority: 'Local ward office (synthetic)', reportedAt: '2026-09-30T09:10:00Z', status: 'in_progress', resolvedAt: null, photoName: null, photoDataUrl: null },
  { id: 'ui-3', urbanAssetId: 'ua-3', reporterId: 'usr-bv-admin', category: 'Shelter damage', severity: 'low', description: 'Shelter glass replaced after vandalism. (invented incident)', locationLabel: 'Bus stop near college gate', authority: 'Local transport office (synthetic)', reportedAt: '2026-07-28T16:45:00Z', status: 'resolved', resolvedAt: '2026-08-02T10:00:00Z', photoName: null, photoDataUrl: null },
  { id: 'ui-4', urbanAssetId: 'ua-5', reporterId: 'usr-fd-student', category: 'Blocked drain', severity: 'high', description: 'Drain is blocked and water is pooling on the footway. (invented incident)', locationLabel: 'College gate entrance', authority: 'Local ward office (synthetic)', reportedAt: '2026-10-01T15:20:00Z', status: 'reported', resolvedAt: null, photoName: null, photoDataUrl: null },
]
