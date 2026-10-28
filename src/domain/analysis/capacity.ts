/**
 * Capacity and utilisation analysis.
 *
 * Every derived value is computed from recorded fields only. Expected
 * attendance is planning demand; actual attendance is occupancy evidence.
 * Utilisation is only produced when attendance and seat capacity are both
 * recorded. Missing inputs are reported as unavailable, never as zero.
 */
import type {
  AssetCondition,
  Building,
  Complaint,
  Room,
  TimetableSlot,
} from '../types.ts'
import type { Finding } from './types.ts'
import { DISPLAY_TIME_ZONE_LABEL, zonedParts } from '../../lib/time.ts'

export const NEEDS_THRESHOLDS = { stressed: 30, critical: 60 }
export const NEEDS_WEIGHTS = {
  capacity: 40,
  occupancy: 20,
  condition: 15,
  maintenance: 15,
  repeat: 10,
} as const

export type NeedsStatus = 'critical' | 'stressed' | 'adequate' | 'unavailable'

export interface RoomSlotAssessment {
  slotId: string
  activity: string
  startsAt: string
  endsAt: string
  capacity: number | null
  expectedAttendance: number | null
  attendance: number | null
  shortageSeats: number | null
  expectedFill: number | null
  utilisation: number | null
}

export interface NeedsComponent {
  key: 'capacity' | 'occupancy' | 'condition' | 'maintenance' | 'repeat'
  label: string
  maxPoints: number
  points: number | null
  available: boolean
  detail: string
}

export interface RoomNeedsProfile {
  roomId: string
  code: string
  name: string
  buildingId: string
  buildingName: string
  capacity: number | null
  condition: AssetCondition | null
  slots: RoomSlotAssessment[]
  expectedPeak: number | null
  maxShortageSeats: number | null
  shortageSlots: number
  comparableSlots: number
  attendedSlots: number
  averageUtilisation: number | null
  averageExpectedFill: number | null
  missingDemandSlots: number
  missingAttendanceSlots: number
  unresolvedComplaints: number
  repeatCategoryCount: number
  score: number | null
  status: NeedsStatus
  provisional: boolean
  components: NeedsComponent[]
  missingInputs: string[]
  method: string
}

export interface CapacityShortage {
  roomId: string
  roomCode: string
  roomName: string
  buildingName: string
  slotId: string
  activity: string
  startsAt: string
  endsAt: string
  expectedAttendance: number
  capacity: number
  shortageSeats: number
  expectedFill: number
  observedAttendance: number | null
  observedUtilisation: number | null
}

export interface TimetableOverlap {
  id: string
  roomId: string
  roomCode: string
  roomName: string
  minutes: number
  a: TimetableSlot
  b: TimetableSlot
}

export interface NeedsAnalysis {
  rooms: RoomNeedsProfile[]
  shortages: CapacityShortage[]
  overlaps: TimetableOverlap[]
  statusCounts: Record<NeedsStatus, number>
  assessedRooms: number
  unassessedRooms: number
  findings: Finding[]
  methods: string[]
}

const COMPONENT_LABELS: Record<NeedsComponent['key'], string> = {
  capacity: 'Capacity shortfall',
  occupancy: 'Observed occupancy pressure',
  condition: 'Room condition',
  maintenance: 'Open maintenance',
  repeat: 'Repeat complaints',
}

const METHOD_NOTES = [
  'Capacity shortfall is scored 0-40: any seat shortfall contributes 20 points, plus up to 20 more in proportion to the worst recorded shortfall against seat capacity.',
  'Observed occupancy pressure is scored 0-20 only when actual attendance exists; points begin above 85% of seat capacity and reach 20 at 100% or above.',
  'Room condition adds 0-15 points (good 0, fair 8, poor 15). Open room complaints add up to 15 points by severity.',
  'Repeat complaints in the last 180 days add 10 points. The Needs Score is the sum of available components; missing components are reported, not scored as zero.',
  `Status thresholds: Adequate below ${NEEDS_THRESHOLDS.stressed}, Stressed ${NEEDS_THRESHOLDS.stressed}-${NEEDS_THRESHOLDS.critical - 1}, Critical ${NEEDS_THRESHOLDS.critical} and above. Rooms without any usable capacity or occupancy evidence are shown as Not assessed rather than scored.`,
  'Utilisation uses actual attendance only; expected attendance is shown separately as demand. Overlaps are flagged for investigation and are not automatically treated as invalid.',
]

const SEVERITY_POINTS = { critical: 7, high: 5, medium: 3, low: 1 } as const

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseTime(value: string): number {
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}

function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null
  return numerator / denominator
}

function round(value: number): number {
  return Math.round(value)
}

/**
 * Timetable bookings that record no enrolled class size. Faculty cannot log
 * attendance for these sessions, so the Overview reports how many exist rather
 * than treating them as demand of zero.
 */
export function slotsWithoutEnrolledNumber(slots: readonly TimetableSlot[]): number {
  return slots.filter((slot) => slot.expectedAttendance === null).length
}

export function analyseNeeds(
  rooms: Room[],
  timetable: TimetableSlot[],
  buildings: Building[],
  complaints: Complaint[],
  asOf: string,
): NeedsAnalysis {
  const asOfTime = Date.parse(asOf)
  const reference = Number.isNaN(asOfTime) ? Date.now() : asOfTime
  const buildingNames = new Map(buildings.map((building) => [building.id, building.name]))
  const slotsByRoom = new Map<string, TimetableSlot[]>()
  for (const slot of timetable) {
    const bucket = slotsByRoom.get(slot.roomId) ?? []
    bucket.push(slot)
    slotsByRoom.set(slot.roomId, bucket)
  }

  const complaintsByRoom = new Map<string, Complaint[]>()
  for (const complaint of complaints) {
    if (!complaint.roomId) continue
    const bucket = complaintsByRoom.get(complaint.roomId) ?? []
    bucket.push(complaint)
    complaintsByRoom.set(complaint.roomId, bucket)
  }

  const profiles: RoomNeedsProfile[] = rooms.map((room) => {
    const slots = [...(slotsByRoom.get(room.id) ?? [])].sort(
      (a, b) => parseTime(a.startsAt) - parseTime(b.startsAt),
    )
    const capacity = asNumber(room.capacity)
    const slotAssessments: RoomSlotAssessment[] = slots.map((slot) => {
      const expected = asNumber(slot.expectedAttendance)
      const attendance = asNumber(slot.attendance)
      return {
        slotId: slot.id,
        activity: slot.activity,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        capacity,
        expectedAttendance: expected,
        attendance,
        shortageSeats: expected !== null && capacity !== null ? expected - capacity : null,
        expectedFill: expected !== null ? ratio(expected, capacity ?? 0) : null,
        utilisation: attendance !== null ? ratio(attendance, capacity ?? 0) : null,
      }
    })

    const comparable = slotAssessments.filter(
      (slot) => slot.expectedAttendance !== null && slot.capacity !== null,
    )
    const shortages = comparable
      .map((slot) => slot.shortageSeats)
      .filter((value): value is number => value !== null)
    const maxShortageSeats = shortages.length > 0 ? Math.max(...shortages) : null
    const shortageSlots = shortages.filter((value) => value > 0).length
    const expectedPeak =
      slotAssessments.length > 0
        ? Math.max(
            ...slotAssessments.map((slot) => slot.expectedAttendance ?? Number.NEGATIVE_INFINITY),
          )
        : null
    const peak = expectedPeak !== null && Number.isFinite(expectedPeak) ? expectedPeak : null

    const attended = slotAssessments.filter((slot) => slot.utilisation !== null)
    const expectedFilled = slotAssessments.filter((slot) => slot.expectedFill !== null)
    const averageUtilisation =
      attended.length > 0
        ? attended.reduce((sum, slot) => sum + (slot.utilisation ?? 0), 0) / attended.length
        : null
    const averageExpectedFill =
      expectedFilled.length > 0
        ? expectedFilled.reduce((sum, slot) => sum + (slot.expectedFill ?? 0), 0) /
          expectedFilled.length
        : null
    const missingDemandSlots = slotAssessments.filter(
      (slot) => slot.expectedAttendance === null,
    ).length
    const missingAttendanceSlots = slotAssessments.filter((slot) => slot.attendance === null).length

    const roomComplaints = complaintsByRoom.get(room.id) ?? []
    const unresolved = roomComplaints.filter(
      (complaint) => complaint.status === 'open' || complaint.status === 'in_progress',
    )
    const recent = roomComplaints.filter(
      (complaint) => reference - parseTime(complaint.raisedAt) <= 180 * 24 * 60 * 60 * 1000,
    )
    const categoryCounts = new Map<string, number>()
    for (const complaint of recent) {
      categoryCounts.set(complaint.category, (categoryCounts.get(complaint.category) ?? 0) + 1)
    }
    const repeatedCategories = [...categoryCounts.entries()].filter(([, count]) => count >= 2)
    const maintenancePoints = Math.min(
      NEEDS_WEIGHTS.maintenance,
      unresolved.reduce((sum, complaint) => sum + (SEVERITY_POINTS[complaint.severity] ?? 0), 0),
    )
    const repeatPoints = repeatedCategories.length > 0 ? NEEDS_WEIGHTS.repeat : 0

    const capacityAvailable = capacity !== null && comparable.length > 0
    const occupancyAvailable = capacity !== null && capacity > 0 && attended.length > 0
    const conditionAvailable = room.condition !== null

    let capacityPoints = 0
    if (capacityAvailable && maxShortageSeats !== null && maxShortageSeats > 0 && capacity > 0) {
      capacityPoints = 20 + Math.min(20, round(20 * (maxShortageSeats / capacity)))
    }
    let occupancyPoints = 0
    if (occupancyAvailable && averageUtilisation !== null) {
      occupancyPoints = Math.min(
        NEEDS_WEIGHTS.occupancy,
        round((NEEDS_WEIGHTS.occupancy * Math.max(0, averageUtilisation - 0.85)) / 0.15),
      )
    }
    let conditionPoints = 0
    if (conditionAvailable) {
      conditionPoints = room.condition === 'poor' ? 15 : room.condition === 'fair' ? 8 : 0
    }

    const components: NeedsComponent[] = [
      {
        key: 'capacity',
        label: COMPONENT_LABELS.capacity,
        maxPoints: NEEDS_WEIGHTS.capacity,
        points: capacityAvailable ? capacityPoints : null,
        available: capacityAvailable,
        detail:
          capacity === null
            ? 'Seat capacity is not recorded.'
            : comparable.length === 0
              ? 'No booking has both expected attendance and seat capacity.'
              : maxShortageSeats !== null && maxShortageSeats > 0
                ? `Worst recorded demand is ${maxShortageSeats} seat(s) above capacity.`
                : 'No recorded booking exceeds seat capacity.',
      },
      {
        key: 'occupancy',
        label: COMPONENT_LABELS.occupancy,
        maxPoints: NEEDS_WEIGHTS.occupancy,
        points: occupancyAvailable ? occupancyPoints : null,
        available: occupancyAvailable,
        detail:
          attended.length === 0
            ? 'Actual attendance is not recorded, so utilisation is not calculated.'
            : averageUtilisation !== null
              ? `Average observed utilisation is ${(averageUtilisation * 100).toFixed(0)}% across ${attended.length} recorded session(s).`
              : 'Utilisation cannot be calculated without seat capacity.',
      },
      {
        key: 'condition',
        label: COMPONENT_LABELS.condition,
        maxPoints: NEEDS_WEIGHTS.condition,
        points: conditionAvailable ? conditionPoints : null,
        available: conditionAvailable,
        detail: conditionAvailable
          ? `Room condition is recorded as ${room.condition}.`
          : 'Room condition is not recorded.',
      },
      {
        key: 'maintenance',
        label: COMPONENT_LABELS.maintenance,
        maxPoints: NEEDS_WEIGHTS.maintenance,
        points: maintenancePoints,
        available: true,
        detail:
          unresolved.length === 0
            ? 'No open or in-progress complaints target this room.'
            : `${unresolved.length} open or in-progress room complaint(s).`,
      },
      {
        key: 'repeat',
        label: COMPONENT_LABELS.repeat,
        maxPoints: NEEDS_WEIGHTS.repeat,
        points: repeatPoints,
        available: true,
        detail:
          repeatedCategories.length === 0
            ? 'No repeated complaint category in the last 180 days.'
            : repeatedCategories
                .map(([category, count]) => `${category}: ${count} complaints`)
                .join('; '),
      },
    ]

    const assessable =
      capacityAvailable || occupancyAvailable
    const totalScore = assessable
      ? Math.min(
          100,
          components.reduce((sum, component) => sum + (component.points ?? 0), 0),
        )
      : null
    const status: NeedsStatus =
      totalScore === null
        ? 'unavailable'
        : totalScore >= NEEDS_THRESHOLDS.critical
          ? 'critical'
          : totalScore >= NEEDS_THRESHOLDS.stressed
            ? 'stressed'
            : 'adequate'

    const missingInputs: string[] = []
    if (capacity === null) missingInputs.push('Seat capacity is not recorded.')
    if (slotAssessments.length === 0) missingInputs.push('No timetable bookings are recorded for this room.')
    if (missingDemandSlots > 0)
      missingInputs.push(
        `Expected attendance is missing for ${missingDemandSlots} booking${missingDemandSlots === 1 ? '' : 's'}.`,
      )
    if (missingAttendanceSlots > 0)
      missingInputs.push(
        `Actual attendance is missing for ${missingAttendanceSlots} booking${missingAttendanceSlots === 1 ? '' : 's'}; utilisation is not calculated.`,
      )
    if (!conditionAvailable) missingInputs.push('Room condition is not recorded.')

    return {
      roomId: room.id,
      code: room.code,
      name: room.name ?? room.code,
      buildingId: room.buildingId,
      buildingName: buildingNames.get(room.buildingId) ?? room.buildingId,
      capacity,
      condition: room.condition,
      slots: slotAssessments,
      expectedPeak: peak,
      maxShortageSeats,
      shortageSlots,
      comparableSlots: comparable.length,
      attendedSlots: attended.length,
      averageUtilisation,
      averageExpectedFill,
      missingDemandSlots,
      missingAttendanceSlots,
      unresolvedComplaints: unresolved.length,
      repeatCategoryCount: repeatedCategories.length,
      score: totalScore,
      status,
      provisional: missingInputs.length > 0,
      components,
      missingInputs,
      method:
        'Needs Score from capacity shortfall (40), observed occupancy (20), condition (15), open complaints (15) and repeat complaints (10). Only available components are scored.',
    }
  })

  const statusCounts: Record<NeedsStatus, number> = {
    critical: 0,
    stressed: 0,
    adequate: 0,
    unavailable: 0,
  }
  for (const profile of profiles) statusCounts[profile.status] += 1

  profiles.sort((a, b) => {
    const order: Record<NeedsStatus, number> = {
      critical: 0,
      stressed: 1,
      adequate: 2,
      unavailable: 3,
    }
    const statusOrder = order[a.status] - order[b.status]
    if (statusOrder !== 0) return statusOrder
    return (b.score ?? -1) - (a.score ?? -1) || a.code.localeCompare(b.code)
  })

  const shortages: CapacityShortage[] = []
  for (const room of rooms) {
    const profile = profiles.find((item) => item.roomId === room.id)
    if (!profile) continue
    for (const slot of profile.slots) {
      if (
        slot.shortageSeats !== null &&
        slot.shortageSeats > 0 &&
        slot.expectedAttendance !== null &&
        slot.capacity !== null
      ) {
        shortages.push({
          roomId: room.id,
          roomCode: room.code,
          roomName: room.name ?? room.code,
          buildingName: profile.buildingName,
          slotId: slot.slotId,
          activity: slot.activity,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          expectedAttendance: slot.expectedAttendance,
          capacity: slot.capacity,
          shortageSeats: slot.shortageSeats,
          expectedFill: slot.expectedFill ?? 0,
          observedAttendance: slot.attendance,
          observedUtilisation: slot.utilisation,
        })
      }
    }
  }
  shortages.sort((a, b) => b.shortageSeats - a.shortageSeats || a.startsAt.localeCompare(b.startsAt))

  const overlaps = findOverlaps(timetable, rooms)
  const findings: Finding[] = []

  for (const room of profiles) {
    if (room.maxShortageSeats !== null && room.maxShortageSeats > 0 && room.capacity !== null) {
      const ratioOver = room.maxShortageSeats / Math.max(1, room.capacity)
      const observedOver = room.averageUtilisation !== null && room.averageUtilisation > 1
      const severity: Finding['severity'] =
        ratioOver >= 0.25 || observedOver ? 'critical' : ratioOver >= 0.1 ? 'high' : 'medium'
      const worst = [...room.slots]
        .filter((slot) => slot.shortageSeats !== null)
        .sort((a, b) => (b.shortageSeats ?? 0) - (a.shortageSeats ?? 0))[0]
      findings.push({
        id: `capacity-${room.roomId}`,
        module: 'capacity',
        severity,
        title: `Room ${room.code} is over capacity`,
        summary:
          worldNumber(room.maxShortageSeats, 'seat') +
          ' above recorded seat capacity in the worst booking' +
          (worst ? ` (${worst.activity})` : '') +
          '.',
        evidence: [
          `Seat capacity: ${room.capacity}.`,
          worst
            ? `Expected attendance: ${worst.expectedAttendance ?? 'not recorded'} for ${formatWindow(worst.startsAt, worst.endsAt)}.`
            : 'Expected attendance is recorded.',
          room.averageUtilisation !== null
            ? `Average observed utilisation: ${(room.averageUtilisation * 100).toFixed(0)}% across ${room.attendedSlots} session(s) with attendance.`
            : 'Actual attendance is not recorded for these bookings, so utilisation is unavailable.',
          `Needs Score: ${room.score ?? 'not assessed'} (${room.status}).`,
        ],
        limitations: [
          'Expected attendance is planning evidence, not proof that every seat was occupied.',
          ...room.missingInputs,
        ],
        subjectIds: [room.roomId, ...room.slots.map((slot) => slot.slotId)],
        facts: {
          room: {
            id: room.roomId,
            code: room.code,
            name: room.name,
            building: room.buildingName,
            capacity: room.capacity,
            condition: room.condition,
            needsScore: room.score,
            needsStatus: room.status,
          },
          worstSlot: worst ?? null,
          shortagesInRoom: room.shortageSlots,
          comparableSlots: room.comparableSlots,
          averageObservedUtilisation: room.averageUtilisation,
          components: room.components,
          missingInputs: room.missingInputs,
          method: room.method,
        },
      })
    }

    if (
      room.capacity === null &&
      room.slots.some((slot) => slot.expectedAttendance !== null)
    ) {
      findings.push({
        id: `capacity-missing-${room.roomId}`,
        module: 'capacity',
        severity: 'medium',
        title: `Seat capacity is missing for room ${room.code}`,
        summary:
          'Timetable demand exists, but seat capacity is not recorded, so a shortage cannot be calculated without assuming a value.',
        evidence: [
          `${room.slots.filter((slot) => slot.expectedAttendance !== null).length} booking(s) record expected attendance.`,
          'Seat capacity is null in the room register.',
        ],
        limitations: ['No capacity or utilisation conclusion is drawn for this room.'],
        subjectIds: [room.roomId],
        facts: {
          roomId: room.roomId,
          roomCode: room.code,
          capacity: null,
          expectedBookings: room.slots
            .filter((slot) => slot.expectedAttendance !== null)
            .map((slot) => ({
              slotId: slot.slotId,
              expectedAttendance: slot.expectedAttendance,
              startsAt: slot.startsAt,
            })),
          missingInputs: room.missingInputs,
        },
      })
    }

    if (
      room.capacity !== null &&
      room.attendedSlots > 0 &&
      room.averageUtilisation !== null &&
      room.averageUtilisation < 0.5
    ) {
      findings.push({
        id: `capacity-underuse-${room.roomId}`,
        module: 'capacity',
        severity: 'info',
        title: `Low observed attendance in room ${room.code}`,
        summary: `Average recorded attendance was ${(room.averageUtilisation * 100).toFixed(0)}% of seat capacity across ${room.attendedSlots} session(s).`,
        evidence: room.slots
          .filter((slot) => slot.utilisation !== null)
          .map(
            (slot) =>
              `${slot.activity}: ${slot.attendance} attended of ${slot.capacity} seats (${((slot.utilisation ?? 0) * 100).toFixed(0)}%).`,
          ),
        limitations: [
          'Only sessions with recorded attendance are counted.',
          'Low attendance may reflect timetabling or choice, not necessarily surplus capacity.',
        ],
        subjectIds: [room.roomId],
        facts: {
          roomId: room.roomId,
          roomCode: room.code,
          averageUtilisation: room.averageUtilisation,
          attendedSlots: room.attendedSlots,
          expectedPeak: room.expectedPeak,
          method:
            'Average of attendance / seat capacity across sessions where both values were recorded.',
        },
      })
    }

    if (room.slots.length > 0 && room.attendedSlots === 0) {
      findings.push({
        id: `capacity-unobserved-${room.roomId}`,
        module: 'data',
        severity: 'info',
        title: `Attendance is not recorded for room ${room.code}`,
        summary:
          'Utilisation cannot be calculated for this room because no booking has actual attendance. Demand is assessed from expected attendance only.',
        evidence: [`${room.slots.length} booking(s) exist; 0 include actual attendance.`],
        limitations: ['Expected attendance is not a substitute for observed occupancy.'],
        subjectIds: [room.roomId],
        facts: {
          roomId: room.roomId,
          bookings: room.slots.length,
          missingAttendanceSlots: room.missingAttendanceSlots,
        },
      })
    }
  }

  for (const overlap of overlaps) {
    findings.push({
      id: overlap.id,
      module: 'capacity',
      severity: 'medium',
      title: `Timetable overlap in room ${overlap.roomCode}`,
      summary: `Two bookings overlap by ${overlap.minutes} minute${overlap.minutes === 1 ? '' : 's'}. This is flagged for investigation, not automatically declared invalid.`,
      evidence: [
        `${overlap.a.activity}: ${formatWindow(overlap.a.startsAt, overlap.a.endsAt)}.`,
        `${overlap.b.activity}: ${formatWindow(overlap.b.startsAt, overlap.b.endsAt)}.`,
      ],
      limitations: [
        'Overlap detection compares recorded times only; it does not know whether one booking was cancelled or moved.',
      ],
      subjectIds: [overlap.roomId, overlap.a.id, overlap.b.id],
      facts: {
        roomId: overlap.roomId,
        roomCode: overlap.roomCode,
        overlapMinutes: overlap.minutes,
        bookingA: overlap.a,
        bookingB: overlap.b,
      },
    })
  }

  return {
    rooms: profiles,
    shortages,
    overlaps,
    statusCounts,
    assessedRooms: profiles.filter((room) => room.status !== 'unavailable').length,
    unassessedRooms: profiles.filter((room) => room.status === 'unavailable').length,
    findings,
    methods: METHOD_NOTES,
  }
}

function findOverlaps(timetable: TimetableSlot[], rooms: Room[]): TimetableOverlap[] {
  const roomCodes = new Map(rooms.map((room) => [room.id, room.code]))
  const roomNames = new Map(rooms.map((room) => [room.id, room.name ?? room.code]))
  const byRoom = new Map<string, TimetableSlot[]>()
  for (const slot of timetable) {
    const bucket = byRoom.get(slot.roomId) ?? []
    bucket.push(slot)
    byRoom.set(slot.roomId, bucket)
  }
  const overlaps: TimetableOverlap[] = []
  for (const [roomId, slots] of byRoom) {
    const ordered = [...slots].sort((a, b) => parseTime(a.startsAt) - parseTime(b.startsAt))
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i]
        const b = ordered[j]
        const start = Math.max(parseTime(a.startsAt), parseTime(b.startsAt))
        const end = Math.min(parseTime(a.endsAt), parseTime(b.endsAt))
        if (end <= start) {
          if (parseTime(b.startsAt) >= parseTime(a.endsAt)) break
          continue
        }
        const minutes = Math.round((end - start) / 60_000)
        overlaps.push({
          id: `capacity-overlap-${roomId}-${a.id}-${b.id}`,
          roomId,
          roomCode: roomCodes.get(roomId) ?? roomId,
          roomName: roomNames.get(roomId) ?? roomId,
          minutes,
          a,
          b,
        })
        if (parseTime(b.startsAt) >= parseTime(a.endsAt)) break
      }
    }
  }
  return overlaps.sort((a, b) => b.minutes - a.minutes)
}

function worldNumber(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`
}

function formatWindow(startsAt: string, endsAt: string): string {
  const start = zonedParts(startsAt)
  const end = zonedParts(endsAt)
  if (!start || !end) return `${startsAt} - ${endsAt}`
  const day = `${start.day}-${start.month}-${start.year}`
  return `${day}, ${start.hour}:${start.minute}-${end.hour}:${end.minute} ${DISPLAY_TIME_ZONE_LABEL}`
}
