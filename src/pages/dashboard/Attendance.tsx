import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/auth-context'
import { api, ApiError } from '../../lib/api'
import { ATTENDANCE_REASONS, ATTENDANCE_REASON_LABELS, ROLE_LABELS } from '../../domain/types'
import type { AttendanceReason, TimetableSlot } from '../../domain/types'
import { formatIstDateKey, formatIstDateTime, formatIstTime, istDateKey } from '../../lib/time'
import { EmptyPanel } from '../../components/ui/PageState'
import Notice from '../../components/ui/Notice'

const fieldClass =
  'mt-1 min-h-12 w-full min-w-0 rounded-md border border-violet/40 bg-obsidian px-3 py-2.5 text-base text-ivory focus-ring'
const labelClass = 'block font-mono text-[0.6875rem] uppercase tracking-widest text-gold'

function slotTime(slot: TimetableSlot): string {
  return `${formatIstTime(slot.startsAt) ?? 'time missing'}–${formatIstTime(slot.endsAt) ?? 'time missing'}`
}

export default function Attendance() {
  const { workspace, refresh } = useAuth()
  const today = workspace ? istDateKey(workspace.serverTime) ?? istDateKey(Date.now()) ?? '' : ''
  const [sessionDate, setSessionDate] = useState(today)
  const [roomId, setRoomId] = useState('')
  const [slotId, setSlotId] = useState('')
  const [presentInput, setPresentInput] = useState('')
  const [reasons, setReasons] = useState<AttendanceReason[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  if (!workspace) return null

  const data = workspace.dataset
  const slots = data.timetableSlots
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]))
  const roomsById = new Map(data.rooms.map((room) => [room.id, room]))
  const dateSlots = slots
    .filter((slot) => istDateKey(slot.startsAt) === sessionDate)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const roomsOnDate = [...new Set(dateSlots.map((slot) => slot.roomId))]
    .flatMap((id) => {
      const room = roomsById.get(id)
      return room ? [room] : []
    })
    .sort((a, b) => a.code.localeCompare(b.code))
  const roomSlots = roomId ? dateSlots.filter((slot) => slot.roomId === roomId) : []
  const slot = slotId ? slotsById.get(slotId) ?? null : null
  const enrolled = slot?.expectedAttendance ?? null
  const recordsForDate = data.attendanceRecords.filter((record) => record.sessionDate === sessionDate)
  const existingRecord = recordsForDate.find((record) => record.slotId === slotId) ?? null
  const loggedSlotIds = new Set(recordsForDate.map((record) => record.slotId))
  const pendingSlots = dateSlots.filter((item) => !loggedSlotIds.has(item.id))
  const latestDate = slots
    .map((item) => istDateKey(item.startsAt))
    .filter((value): value is string => Boolean(value))
    .sort()
    .slice(-1)[0] ?? null

  const dateLabel = formatIstDateKey(sessionDate) ?? sessionDate
  const isToday = sessionDate === today
  const present = presentInput === '' ? null : Number(presentInput)
  const overEnrolled = present !== null && enrolled !== null && present > enrolled
  const canSave = slot !== null && enrolled !== null && present !== null && !overEnrolled && !busy

  const resetSelection = () => {
    setSlotId('')
    setPresentInput('')
    setReasons([])
    setError(null)
    setSaved(null)
  }

  const changeDate = (value: string) => {
    setSessionDate(value)
    setRoomId('')
    resetSelection()
  }

  const changeRoom = (value: string) => {
    setRoomId(value)
    resetSelection()
  }

  const selectSlot = (nextSlotId: string) => {
    const next = slotsById.get(nextSlotId) ?? null
    const record = data.attendanceRecords.find(
      (item) => item.slotId === nextSlotId && item.sessionDate === sessionDate,
    )
    setRoomId(next?.roomId ?? roomId)
    setSlotId(nextSlotId)
    setPresentInput(record ? String(record.present) : '')
    setReasons(record ? record.reasons : [])
    setError(null)
    setSaved(null)
  }

  const toggleReason = (reason: AttendanceReason) => {
    setReasons((current) =>
      current.includes(reason) ? current.filter((item) => item !== reason) : [...current, reason],
    )
  }

  const typePresent = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 5)
    setPresentInput(digits)
    setSaved(null)
    if (digits !== '' && enrolled !== null && Number(digits) > enrolled) {
      setError(`Present cannot be more than the ${enrolled} students enrolled in this class.`)
    } else {
      setError(null)
    }
  }

  const step = (delta: number) => {
    setSaved(null)
    if (present === null) {
      if (delta > 0) {
        if (enrolled !== null && 1 > enrolled) {
          setError(enrolledMessage(enrolled))
          return
        }
        setPresentInput('1')
        setError(null)
      }
      return
    }
    const next = present + delta
    if (next < 0) return
    if (enrolled !== null && next > enrolled) {
      setError(enrolledMessage(enrolled))
      return
    }
    setError(null)
    setPresentInput(String(next))
  }

  const save = async () => {
    setError(null)
    setSaved(null)
    if (!slot) {
      setError('Choose a room and time slot first.')
      return
    }
    if (present === null) {
      setError('Enter the number of students present before saving.')
      return
    }
    if (enrolled === null) {
      setError('Expected attendance is not recorded for this slot, so attendance cannot be capped. Add it to the timetable first.')
      return
    }
    if (present > enrolled) {
      setError(enrolledMessage(enrolled))
      return
    }
    setBusy(true)
    try {
      const result = await api.saveAttendance({
        slotId: slot.id,
        sessionDate,
        present,
        reasons,
      })
      setSaved(
        result.created
          ? `Attendance saved for ${slot.activity} on ${dateLabel}.`
          : `Attendance updated for ${slot.activity} on ${dateLabel}.`,
      )
      await refresh()
      document.getElementById('attendance-confirmation')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch (err) {
      const message = err instanceof ApiError
        ? err.fieldErrors.present ?? err.message
        : 'Attendance was not saved. Try again.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const selectFirstRecorded = () => {
    const record = recordsForDate[0]
    if (record) selectSlot(record.slotId)
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-ivory">Log attendance</h1>
        <span className="shrink-0 text-sm text-ivory/60">{ROLE_LABELS[workspace.activeCollege.role]}</span>
      </div>

      <div className="mt-5">
        <label htmlFor="attendance-date" className={labelClass}>
          Date
        </label>
        <input
          id="attendance-date"
          type="date"
          value={sessionDate}
          onChange={(event) => changeDate(event.target.value)}
          className={fieldClass}
        />
      </div>

      <div className="mt-4">
        <label htmlFor="attendance-room" className={labelClass}>
          Room
        </label>
        <select
          id="attendance-room"
          value={roomId}
          onChange={(event) => changeRoom(event.target.value)}
          disabled={roomsOnDate.length === 0}
          className={`${fieldClass} disabled:opacity-50`}
        >
          <option value="">Choose a room</option>
          {roomsOnDate.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name ? `${room.name}, ${room.code}` : room.code}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <label htmlFor="attendance-slot" className={labelClass}>
          Time slot
        </label>
        <select
          id="attendance-slot"
          value={slotId}
          onChange={(event) => selectSlot(event.target.value)}
          disabled={roomSlots.length === 0}
          className={`${fieldClass} disabled:opacity-50`}
        >
          <option value="">{roomId ? 'Choose a time slot' : 'Choose a room first'}</option>
          {roomSlots.map((item) => (
            <option key={item.id} value={item.id}>
              {slotTime(item)}, {item.activity}
              {loggedSlotIds.has(item.id) ? ' (logged)' : ''}
            </option>
          ))}
        </select>
      </div>

      {dateSlots.length === 0 && (
        <div className="mt-5">
          <EmptyPanel title="No timetable sessions on this date">
            {slots.length === 0
              ? 'No timetable slots are recorded for this college.'
              : `No session starts on ${dateLabel} in IST. The latest recorded session date is ${formatIstDateKey(latestDate ?? '') ?? 'not available'}.`}
          </EmptyPanel>
          <div className="mt-3">
            {latestDate && latestDate !== sessionDate ? (
              <button
                type="button"
                onClick={() => changeDate(latestDate)}
                className="min-h-11 rounded-md bg-violet px-4 py-2.5 text-sm font-semibold text-white focus-ring"
              >
                Show the latest session date
              </button>
            ) : (
              <Link
                to="/dashboard"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-violet/40 px-4 py-2.5 text-sm font-semibold text-ivory/80 hover:bg-violet/10 focus-ring"
              >
                Back to home
              </Link>
            )}
          </div>
        </div>
      )}

      {slot && (
        <>
          <p className="mt-4 text-sm text-ivory/70">
            Enrolled in this class:{' '}
            {enrolled === null ? (
              <span className="text-status-error-dark">not recorded — add expected attendance to the timetable first</span>
            ) : (
              <>
                <strong className="text-ivory">{enrolled}</strong> (from timetable)
              </>
            )}
          </p>

          <div className="mt-3 rounded-md border border-violet/30 bg-obsidian p-5">
            <p className="text-center text-sm text-ivory/70">Students present</p>
            <div className="mt-3 flex items-center justify-center gap-5">
              <button
                type="button"
                onClick={() => step(-1)}
                disabled={present !== null && present <= 0}
                aria-label="One fewer student present"
                className="grid h-14 w-14 place-items-center rounded-md border border-violet/45 text-2xl font-semibold text-ivory hover:bg-violet/10 disabled:opacity-35 focus-ring"
              >
                −
              </button>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label="Students present"
                placeholder="Not entered"
                value={presentInput}
                onChange={(event) => typePresent(event.target.value)}
                className="min-h-14 w-32 rounded-md border border-violet/30 bg-ink px-2 text-center font-heading text-4xl font-semibold tabular-nums text-ivory placeholder:text-base placeholder:font-normal placeholder:text-ivory/40 focus-ring"
              />
              <button
                type="button"
                onClick={() => step(1)}
                disabled={enrolled !== null && present !== null && present >= enrolled}
                aria-label="One more student present"
                className="grid h-14 w-14 place-items-center rounded-md border border-violet/45 text-2xl font-semibold text-ivory hover:bg-violet/10 disabled:opacity-35 focus-ring"
              >
                +
              </button>
            </div>
            {enrolled !== null && (
              <p className="mt-2 text-center text-xs leading-relaxed text-ivory/45">
                Type the count or use the buttons. Present cannot exceed {enrolled}.
              </p>
            )}

            <details className="mt-4 border-t border-violet/25 pt-2">
              <summary className="min-h-11 cursor-pointer select-none py-2 text-sm font-semibold text-violet-bright focus-ring">
                {reasons.length > 0
                  ? `Quick reasons: ${reasons.map((reason) => ATTENDANCE_REASON_LABELS[reason]).join(', ')}`
                  : 'Quick reasons (optional)'}
              </summary>
              <div className="mt-1 space-y-2 pb-2">
                {ATTENDANCE_REASONS.map((reason) => (
                  <label
                    key={reason}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-violet/30 px-3 py-2 text-sm text-ivory/80 hover:bg-violet/5"
                  >
                    <input
                      type="checkbox"
                      checked={reasons.includes(reason)}
                      onChange={() => toggleReason(reason)}
                      className="h-5 w-5 shrink-0 accent-violet"
                    />
                    {ATTENDANCE_REASON_LABELS[reason]}
                  </label>
                ))}
                <p className="text-xs leading-relaxed text-ivory/45">
                  Ticked reasons are stored as evidence for the room.
                </p>
              </div>
            </details>
          </div>

          {error && (
            <div id="attendance-confirmation" className="mt-4">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}
          {saved && !error && (
            <div id="attendance-confirmation" className="mt-4">
              <Notice tone="success">{saved}</Notice>
            </div>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className="mt-4 min-h-14 w-full rounded-md bg-violet px-5 py-3 text-base font-semibold text-white disabled:opacity-40 focus-ring"
          >
            {busy ? 'Saving…' : 'Save attendance'}
          </button>

          {existingRecord && (
            <p className="mt-2 text-center text-xs text-ivory/55">
              Logged by {existingRecord.recordedByName}, last updated{' '}
              {formatIstDateTime(existingRecord.updatedAt) ?? existingRecord.updatedAt}
            </p>
          )}
        </>
      )}

      {dateSlots.length > 0 && (
        <div className="mt-6 rounded-md border border-violet/30 bg-obsidian p-5">
          <h2 className="font-heading text-lg font-semibold text-ivory">
            {isToday ? 'Still to log today' : `Still to log on ${dateLabel}`} ({pendingSlots.length})
          </h2>
          {pendingSlots.length === 0 ? (
            <div className="mt-3">
              <p className="text-sm text-ivory/65">Every session on this date has attendance recorded.</p>
              <button
                type="button"
                onClick={selectFirstRecorded}
                className="mt-3 min-h-11 rounded-md border border-violet/45 px-4 py-2 text-sm font-semibold text-violet-bright hover:bg-violet/10 focus-ring"
              >
                Review a saved session
              </button>
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-violet/20">
              {pendingSlots.map((item) => {
                const room = roomsById.get(item.roomId)
                const missing = item.expectedAttendance === null
                return (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ivory">
                        {formatIstTime(item.startsAt) ?? 'time missing'}, {room?.code ?? 'Room not in view'}, {item.activity}
                      </p>
                      {missing && (
                        <p className="mt-0.5 text-xs text-ivory/55">Expected attendance is not recorded.</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        selectSlot(item.id)
                        scrollTo('attendance-date')
                      }}
                      disabled={missing}
                      className="min-h-11 shrink-0 rounded-md border border-violet/45 bg-obsidian px-4 py-2 text-sm font-semibold text-ivory hover:bg-violet/10 disabled:opacity-40 focus-ring"
                    >
                      Log
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {pendingSlots.some((item) => item.expectedAttendance === null) && (
            <p className="mt-3 border-t border-violet/20 pt-3 text-xs leading-relaxed text-ivory/45">
              A slot with no expected attendance cannot be capped, so it is not logged here. Add expected attendance
              to the timetable first.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function enrolledMessage(enrolled: number): string {
  return `Present cannot be more than the ${enrolled} students enrolled in this class.`
}
