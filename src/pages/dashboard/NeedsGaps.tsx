import { useState } from 'react'
import PageHeading from '../../components/dashboard/PageHeading'
import Panel from '../../components/ui/Panel'
import Stat from '../../components/ui/Stat'
import { Badge } from '../../components/ui/Badge'
import ScoreBar from '../../components/ui/ScoreBar'
import Modal from '../../components/ui/Modal'
import FindingExplainer from '../../components/dashboard/FindingExplainer'
import { EmptyPanel } from '../../components/ui/PageState'
import { useAuth } from '../../auth/auth-context'
import { formatDateTime, percentage, titleCase } from '../../lib/format'
import { NEEDS_THRESHOLDS, NEEDS_WEIGHTS } from '../../domain/analysis'
import type { Finding, RoomNeedsProfile } from '../../domain/analysis'
import { ATTENDANCE_REASONS, ATTENDANCE_REASON_LABELS } from '../../domain/types'
import type { AttendanceReason } from '../../domain/types'

const STATUS_TONE = {
  critical: 'error',
  stressed: 'warn',
  adequate: 'ok',
  unavailable: 'neutral',
} as const

const STATUS_ICON = {
  critical: '▲',
  stressed: '◆',
  adequate: '●',
  unavailable: '?',
} as const

function NeedsStatusBadge({ status }: { status: RoomNeedsProfile['status'] }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      <span aria-hidden="true" className="text-[0.6875rem] leading-none">{STATUS_ICON[status]}</span>
      {titleCase(status)}
    </Badge>
  )
}

export default function NeedsGaps() {
  const { analysis, workspace } = useAuth()
  const [explained, setExplained] = useState<Finding | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | RoomNeedsProfile['status']>('all')

  if (!analysis || !workspace) return null
  const capacity = analysis.capacity
  const rooms = capacity.rooms.filter((room) => statusFilter === 'all' || room.status === statusFilter)

  const slotRoomIds = new Map(workspace.dataset.timetableSlots.map((slot) => [slot.id, slot.roomId]))
  const feedbackByRoom = new Map<string, Record<AttendanceReason, number>>()
  for (const record of workspace.dataset.attendanceRecords) {
    const roomId = slotRoomIds.get(record.slotId)
    if (!roomId || record.reasons.length === 0) continue
    const counts = feedbackByRoom.get(roomId) ?? { room_too_small: 0, too_hot: 0, projector_not_working: 0 }
    for (const reason of record.reasons) counts[reason] += 1
    feedbackByRoom.set(roomId, counts)
  }

  return (
    <div>
      <PageHeading
        kicker="Module 02 — Needs & Gaps"
        title="Capacity against recorded demand"
        description="Room shortages, timetable clashes and pressure scores based on booked demand and recorded attendance. Utilisation is only shown when both attendance and seat capacity are recorded."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Rooms scored"
          value={capacity.assessedRooms}
          detail={`${capacity.unassessedRooms} room(s) cannot be scored — records missing`}
          tone={capacity.statusCounts.critical > 0 ? 'high' : 'default'}
        />
        <Stat
          label="Critical rooms"
          value={capacity.statusCounts.critical}
          detail={`${capacity.statusCounts.stressed} stressed · ${capacity.statusCounts.adequate} adequate`}
          tone={capacity.statusCounts.critical > 0 ? 'critical' : 'default'}
        />
        <Stat
          label="Shortfall slots"
          value={capacity.shortages.length}
          detail="Bookings whose expected attendance exceeds seat capacity"
          tone={capacity.shortages.length > 0 ? 'high' : 'good'}
        />
        <Stat
          label="Timetable overlaps"
          value={capacity.overlaps.length}
          detail="Same room booked at overlapping times"
          tone={capacity.overlaps.length > 0 ? 'high' : 'default'}
        />
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-8">
          <Panel
            kicker="Room assessments"
            title="Needs scores"
            actions={
              <label className="flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-widest text-ivory/50">
                Status
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                  className="rounded border border-violet/40 bg-ink px-2 py-1 text-xs text-ivory focus-ring"
                >
                  <option value="all">All</option>
                  <option value="critical">Critical</option>
                  <option value="stressed">Stressed</option>
                  <option value="adequate">Adequate</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
            }
          >
            {rooms.length === 0 ? (
              <EmptyPanel title="No rooms match this filter">
                {capacity.rooms.length === 0
                  ? 'No rooms are recorded for this college yet.'
                  : 'Choose another status to see other rooms.'}
              </EmptyPanel>
            ) : (
              <div className="space-y-4">
                {rooms.map((room) => (
                  <article key={room.roomId} className="border border-violet/25 bg-ink/40 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-heading text-lg text-ivory">
                            {room.code}{room.name ? ` — ${room.name}` : ''}
                          </h3>
                          <NeedsStatusBadge status={room.status} />
                          {room.provisional && <Badge tone="outline">Provisional</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-ivory/50">{room.buildingName}</p>
                      </div>
                      <div className="w-full max-w-[220px]">
                        <ScoreBar
                          value={room.score}
                          label="Needs score"
                          thresholds={[
                            { at: NEEDS_THRESHOLDS.stressed, label: 'Stressed', className: 'bg-gold' },
                            { at: NEEDS_THRESHOLDS.critical, label: 'Critical', className: 'bg-status-error-dark' },
                          ]}
                          compact
                        />
                      </div>
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                      <div>
                        <dt className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">Capacity</dt>
                        <dd className="mt-0.5 text-sm text-ivory">{room.capacity === null ? 'Not recorded' : room.capacity}</dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">Peak demand</dt>
                        <dd className="mt-0.5 text-sm text-ivory">{room.expectedPeak === null ? 'Not recorded' : room.expectedPeak}</dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">Shortfall slots</dt>
                        <dd className="mt-0.5 text-sm text-ivory">{room.shortageSlots} of {room.comparableSlots}</dd>
                      </div>
                      <div>
                        <dt className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">Utilisation</dt>
                        <dd className="mt-0.5 text-sm text-ivory">
                          {room.averageUtilisation === null ? (
                            <span className="italic text-ivory/40">Not recorded</span>
                          ) : (
                            percentage(room.averageUtilisation, 1)
                          )}
                        </dd>
                      </div>
                    </dl>

                    <details className="group mt-3 border-t border-violet/20 pt-2">
                      <summary className="cursor-pointer select-none font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright focus-ring">
                        Score breakdown &amp; bookings
                      </summary>
                      <div className="mt-3 grid gap-4 lg:grid-cols-2">
                        <div className="min-w-0">
                          <p className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">Components</p>
                          <ul className="mt-1.5 space-y-1.5 text-xs">
                            {room.components.map((component) => (
                              <li key={component.key} className="flex items-start justify-between gap-3">
                                <span className="text-ivory/65">
                                  {component.label}
                                  <span className="block text-[0.625rem] text-ivory/40">{component.detail}</span>
                                </span>
                                <span className={`shrink-0 font-mono ${component.available ? 'text-ivory' : 'text-ivory/35'}`}>
                                  {component.available ? `${component.points} / ${component.maxPoints}` : 'n/a'}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {room.missingInputs.length > 0 && (
                            <div className="mt-3 border-t border-violet/20 pt-2">
                              <p className="font-mono text-[0.5625rem] uppercase tracking-widest text-gold">Missing inputs</p>
                              <ul className="mt-1 space-y-0.5 text-xs text-ivory/55">
                                {room.missingInputs.map((input, index) => <li key={index}>— {input}</li>)}
                              </ul>
                            </div>
                          )}
                          <div className="mt-3 border-t border-violet/20 pt-2">
                            <p className="font-mono text-[0.5625rem] uppercase tracking-widest text-gold">Attendance feedback</p>
                            {feedbackByRoom.has(room.roomId) ? (
                              <ul className="mt-1 space-y-0.5 text-xs text-ivory/55">
                                {ATTENDANCE_REASONS.map((reason) => {
                                  const count = feedbackByRoom.get(room.roomId)?.[reason] ?? 0
                                  return count > 0 ? (
                                    <li key={reason}>
                                      — {ATTENDANCE_REASON_LABELS[reason]}: {count} session{count === 1 ? '' : 's'}
                                    </li>
                                  ) : null
                                })}
                              </ul>
                            ) : (
                              <p className="mt-1 text-xs italic text-ivory/45">
                                No quick reasons recorded from attendance.
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <p className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">Bookings</p>
                          {room.slots.length === 0 ? (
                            <p className="mt-1.5 text-xs italic text-ivory/45">No timetable bookings recorded for this room.</p>
                          ) : (
                            <div className="mt-1.5 overflow-x-auto">
                              <table className="w-full min-w-[380px] border-collapse text-xs">
                                <thead><tr className="border-b border-violet/20 text-left font-mono text-[0.5625rem] uppercase tracking-widest text-gold/70">
                                  <th className="py-1 pr-2">Activity</th><th className="py-1 pr-2">Starts</th><th className="py-1 pr-2">Exp.</th><th className="py-1 pr-2">Att.</th><th className="py-1">Shortfall</th>
                                </tr></thead>
                                <tbody>
                                  {room.slots.map((slot) => (
                                    <tr key={slot.slotId} className="border-b border-violet/10 last:border-0">
                                      <td className="py-1 pr-2 text-ivory/70">{slot.activity}</td>
                                      <td className="py-1 pr-2 text-ivory/55">{formatDateTime(slot.startsAt)}</td>
                                      <td className="py-1 pr-2 text-ivory/70">{slot.expectedAttendance ?? '—'}</td>
                                      <td className="py-1 pr-2 text-ivory/70">{slot.attendance ?? '—'}</td>
                                      <td className={`py-1 font-mono ${slot.shortageSeats ? 'text-status-error-dark' : 'text-ivory/40'}`}>
                                        {slot.shortageSeats ?? '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="mt-3 border-t border-violet/15 pt-2 text-[0.6875rem] leading-relaxed text-ivory/40">{room.method}</p>
                    </details>
                  </article>
                ))}
              </div>
            )}
          </Panel>

          <Panel kicker="Slot by slot" title="Capacity shortfalls">
            {capacity.shortages.length === 0 ? (
              <p className="text-sm text-ivory/55">No booking currently has expected attendance above its room capacity.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] border-collapse">
                  <thead><tr className="border-b border-violet/30 text-left">
                    <th className="px-3 py-2 font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Room</th>
                    <th className="px-3 py-2 font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Activity</th>
                    <th className="px-3 py-2 font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Starts</th>
                    <th className="px-3 py-2 font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Expected</th>
                    <th className="px-3 py-2 font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Capacity</th>
                    <th className="px-3 py-2 font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Shortfall</th>
                    <th className="px-3 py-2 font-mono text-[0.625rem] uppercase tracking-widest text-gold/80">Observed utilisation</th>
                  </tr></thead>
                  <tbody>
                    {capacity.shortages.map((shortage) => (
                      <tr key={shortage.slotId} className="border-b border-violet/15 last:border-0">
                        <td className="px-3 py-2.5 text-sm text-ivory">{shortage.roomCode}</td>
                        <td className="px-3 py-2.5 text-sm text-ivory/70">{shortage.activity}</td>
                        <td className="px-3 py-2.5 text-sm text-ivory/60">{formatDateTime(shortage.startsAt)}</td>
                        <td className="px-3 py-2.5 text-sm text-ivory/80">{shortage.expectedAttendance}</td>
                        <td className="px-3 py-2.5 text-sm text-ivory/80">{shortage.capacity}</td>
                        <td className="px-3 py-2.5 font-mono text-sm text-status-error-dark">+{shortage.shortageSeats}</td>
                        <td className="px-3 py-2.5 text-sm text-ivory/60">
                          {shortage.observedUtilisation === null ? <span className="italic text-ivory/40">No attendance recorded</span> : percentage(shortage.observedUtilisation, 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {capacity.overlaps.length > 0 && (
            <Panel kicker="Room booking integrity" title="Timetable overlaps">
              <ul className="divide-y divide-violet/20">
                {capacity.overlaps.map((overlap) => (
                  <li key={overlap.id} className="py-2.5 text-sm text-ivory/70 first:pt-0 last:pb-0">
                    <span className="text-ivory">{overlap.roomCode}</span> — {overlap.minutes} minutes between
                    “{overlap.a.activity}” and “{overlap.b.activity}”.
                    <span className="mt-0.5 block text-xs text-ivory/45">
                      {formatDateTime(overlap.a.startsAt)} – {formatDateTime(overlap.a.endsAt)} and{' '}
                      {formatDateTime(overlap.b.startsAt)} – {formatDateTime(overlap.b.endsAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="min-w-0 space-y-8">
          <Panel kicker="Findings" title="Capacity findings">
            {capacity.findings.length === 0 ? (
              <p className="text-sm text-ivory/55">No capacity findings were produced.</p>
            ) : (
              <ul className="divide-y divide-violet/20">
                {capacity.findings.map((finding) => (
                  <li key={finding.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Badge tone={finding.severity === 'critical' ? 'error' : finding.severity === 'high' ? 'warn' : 'outline'}>
                          {titleCase(finding.severity)}
                        </Badge>
                        <p className="mt-1.5 text-sm text-ivory">{finding.title}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-ivory/50">{finding.summary}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExplained(finding)}
                        className="shrink-0 rounded border border-violet/40 px-2 py-1 font-mono text-[0.5625rem] uppercase tracking-widest text-violet-bright hover:bg-violet/15 focus-ring"
                      >
                        How is this calculated?
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel kicker="Method" title="How the score is built">
            <p className="text-sm leading-relaxed text-ivory/65">
              The Needs Score is a fixed 100-point additive score. A component that cannot be calculated is marked
              unavailable and is not scored as zero.
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              {Object.entries(NEEDS_WEIGHTS).map(([key, max]) => (
                <div key={key} className="flex items-baseline justify-between gap-3 border-b border-violet/15 pb-1.5 last:border-0">
                  <dt className="text-ivory/65">{titleCase(key)}</dt>
                  <dd className="font-mono text-ivory/80">max {max}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 border-t border-violet/20 pt-3 text-xs leading-relaxed text-ivory/45">
              Bands: {NEEDS_THRESHOLDS.critical}+ critical, {NEEDS_THRESHOLDS.stressed}–{NEEDS_THRESHOLDS.critical - 1} stressed,
              below {NEEDS_THRESHOLDS.stressed} adequate. Utilisation is only calculated when both attendance and seat
              capacity are recorded; otherwise it is unavailable, not zero.
            </p>
            <details className="mt-4 border-t border-violet/20 pt-3">
              <summary className="cursor-pointer font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright">How is this calculated?</summary>
              <ul className="mt-2 space-y-2 text-xs leading-relaxed text-ivory/50">
                {capacity.methods.map((method, index) => <li key={index}>• {method}</li>)}
              </ul>
            </details>
          </Panel>

          <Panel kicker="What is missing" title="What the records cannot show">
            <p className="text-sm leading-relaxed text-ivory/65">
              This view uses {workspace.dataset.timetableSlots.length} timetable slot(s) and{' '}
              {workspace.dataset.complaints.length} complaint record(s) visible to your role.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-ivory/45">
              Without expected attendance, a booking cannot add to capacity demand. Without actual attendance,
              utilisation cannot be measured. Rooms missing capacity or attendance records are listed as unavailable,
              not scored as zero.
            </p>
          </Panel>
        </div>
      </div>

      <Modal open={Boolean(explained)} onClose={() => setExplained(null)} title="How this is calculated" description="The records and rules behind this finding, what they cannot tell you, and an optional written summary." size="lg">
        {explained && <FindingExplainer finding={explained} methods={capacity.methods} />}
      </Modal>
    </div>
  )
}
