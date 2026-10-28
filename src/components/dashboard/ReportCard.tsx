import { StatusBadge } from '../ui/Badge'
import type { Building, Complaint, Room } from '../../domain/types'
import { REPORT_STEPS, reportStage, reportTitle } from '../../domain/progress'

export { reportStage }

export function reportAge(raisedAt: string, now: string): string {
  const raised = Date.parse(raisedAt)
  const reference = Date.parse(now)
  if (Number.isNaN(raised) || Number.isNaN(reference)) return 'Date not recorded'
  const days = Math.max(0, Math.floor((reference - raised) / 86_400_000))
  if (days === 0) return 'Reported today'
  if (days === 1) return 'Reported 1 day ago'
  return `Reported ${days} days ago`
}

export function reportPlace(
  complaint: Complaint,
  buildingsById: Map<string, Building>,
  roomsById: Map<string, Room>,
): string {
  const building = complaint.buildingId ? buildingsById.get(complaint.buildingId)?.name : null
  const room = complaint.roomId ? roomsById.get(complaint.roomId) : null
  if (room) return [building, `Room ${room.code}`].filter(Boolean).join(' · ')
  if (complaint.roomChoice === 'not_sure') return [building, 'Room not sure'].filter(Boolean).join(' · ')
  return building ?? 'Place not recorded'
}

export function ReportProgress({ stage }: { stage: number }) {
  return (
    <div className="mt-4" aria-label={`Progress: ${REPORT_STEPS[stage]} of ${REPORT_STEPS[REPORT_STEPS.length - 1]}`}>
      <div className="grid grid-cols-4 gap-1">
        {REPORT_STEPS.map((step, index) => (
          <div key={step} className="min-w-0">
            <div
              className={`h-1 rounded-full ${index <= stage ? 'bg-violet' : 'bg-ivory/20'}`}
              aria-hidden="true"
            />
            <p
              className={`mt-1 break-words text-center text-[0.5625rem] uppercase leading-tight tracking-wide ${
                index === stage ? 'font-bold text-ivory' : 'text-ivory/50'
              }`}
            >
              {step}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ReportCard({
  complaint,
  place,
  now,
}: {
  complaint: Complaint
  place: string
  now: string
}) {
  const ticket = complaint.ticketNumber ?? complaint.id
  return (
    <article className="border border-violet/30 bg-obsidian p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-base font-semibold leading-snug text-ivory">
            {reportTitle(complaint.description)}
          </h3>
          <p className="mt-1 text-sm text-ivory/60">{place}</p>
        </div>
        <StatusBadge status={complaint.status} />
      </div>
      <p className="mt-2 font-mono text-[0.625rem] uppercase tracking-wider text-ivory/45">
        {ticket} · {reportAge(complaint.raisedAt, now)}
      </p>
      <ReportProgress stage={reportStage(complaint)} />
    </article>
  )
}
