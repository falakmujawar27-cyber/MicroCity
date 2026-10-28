import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/auth-context'
import { ReportCard, reportPlace } from '../../components/dashboard/ReportCard'

export default function MyReports() {
  const { workspace, session } = useAuth()
  if (!workspace || !session) return null

  const data = workspace.dataset
  const buildingsById = new Map(data.buildings.map((building) => [building.id, building]))
  const roomsById = new Map(data.rooms.map((room) => [room.id, room]))
  const reports = [...data.complaints].sort((a, b) => b.raisedAt.localeCompare(a.raisedAt))

  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold text-ivory">My reports</h1>
      <p className="mt-2 text-sm leading-relaxed text-ivory/65">
        Only your own campus reports appear here. The bold step shows where each one is now.
      </p>

      {reports.length === 0 ? (
        <div className="mt-5 border border-dashed border-violet/40 px-5 py-8 text-center">
          <p className="text-sm text-ivory/65">You have not reported anything yet.</p>
          <Link
            to="/dashboard/report"
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-violet px-4 py-2 text-sm font-semibold text-white focus-ring"
          >
            Report a problem
          </Link>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {reports.map((complaint) => (
            <ReportCard
              key={complaint.id}
              complaint={complaint}
              place={reportPlace(complaint, buildingsById, roomsById)}
              now={workspace.serverTime}
            />
          ))}
        </div>
      )}
    </div>
  )
}
