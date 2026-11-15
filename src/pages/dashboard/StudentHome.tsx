import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/auth-context'
import { Badge, StatusBadge } from '../../components/ui/Badge'
import { ReportCard, reportPlace } from '../../components/dashboard/ReportCard'
import { URBAN_CATEGORY_LABELS } from '../../domain/types'

export default function StudentHome() {
  const { workspace, session } = useAuth()
  if (!workspace || !session) return null

  const data = workspace.dataset
  const buildingsById = new Map(data.buildings.map((building) => [building.id, building]))
  const roomsById = new Map(data.rooms.map((room) => [room.id, room]))
  const myReports = [...data.complaints].sort((a, b) => b.raisedAt.localeCompare(a.raisedAt))
  const publicIssues = [...data.urbanIssues]
    .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))
    .slice(0, 3)

  return (
    <div>
      <p className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">Campus issues</p>
      <h1 className="mt-2 font-heading text-2xl font-semibold leading-tight text-ivory">
        Something broken? Tell the college.
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ivory/65">
        Reports are private to you and the staff who resolve them.
      </p>

      <Link
        to="/dashboard/report"
        className="mt-5 flex min-h-16 w-full items-center justify-between gap-4 rounded-md bg-violet px-5 py-4 text-left text-lg font-semibold text-white shadow-sm focus-ring"
      >
        Report a problem
        <span aria-hidden="true" className="text-xl leading-none">→</span>
      </Link>

      <section className="mt-8" aria-labelledby="my-reports-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="my-reports-heading" className="font-heading text-xl font-semibold text-ivory">My reports</h2>
          {myReports.length > 0 && (
            <Link to="/dashboard/my-reports" className="text-sm font-medium text-violet-bright hover:underline focus-ring">
              View all
            </Link>
          )}
        </div>

        {myReports.length === 0 ? (
          <div className="mt-3 border border-dashed border-violet/40 px-5 py-6 text-center">
            <p className="text-sm text-ivory/65">You have not reported anything yet.</p>
            <Link
              to="/dashboard/report"
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md border border-violet/50 px-4 py-2 text-sm font-semibold text-violet-bright hover:bg-violet/10 focus-ring"
            >
              Report a problem
            </Link>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {myReports.map((complaint) => (
              <ReportCard
                key={complaint.id}
                complaint={complaint}
                place={reportPlace(complaint, buildingsById, roomsById)}
                now={workspace.serverTime}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8" aria-labelledby="public-issues-heading">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="public-issues-heading" className="font-heading text-xl font-semibold text-ivory">
            Public issues near campus
          </h2>
          <Link to="/dashboard/report-public" className="text-sm font-medium text-violet-bright hover:underline focus-ring">
            Report one
          </Link>
        </div>

        {publicIssues.length === 0 ? (
          <div className="mt-3 border border-dashed border-violet/40 px-5 py-6 text-center">
            <p className="text-sm text-ivory/65">No public issues are recorded near campus.</p>
            <Link
              to="/dashboard/report-public"
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md border border-violet/50 px-4 py-2 text-sm font-semibold text-violet-bright hover:bg-violet/10 focus-ring"
            >
              Report a public issue
            </Link>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-violet/20 border-y border-violet/25">
            {publicIssues.map((issue) => {
              const asset = issue.urbanAssetId
                ? data.urbanAssets.find((item) => item.id === issue.urbanAssetId)
                : null
              return (
                <li key={issue.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ivory">
                        {asset ? URBAN_CATEGORY_LABELS[asset.category] : issue.category}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-ivory/65">{issue.description}</p>
                      <p className="mt-1 text-xs text-ivory/50">{issue.locationLabel}</p>
                    </div>
                    <StatusBadge status={issue.status} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ivory/50">
          <Badge tone="outline">College-scoped</Badge>
          Public infrastructure issues are visible inside this college only.
        </p>
      </section>
    </div>
  )
}
