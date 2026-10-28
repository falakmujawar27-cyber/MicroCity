import { useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeading from '../../components/dashboard/PageHeading'
import Panel from '../../components/ui/Panel'
import Stat from '../../components/ui/Stat'
import Notice from '../../components/ui/Notice'
import Modal from '../../components/ui/Modal'
import FindingExplainer from '../../components/dashboard/FindingExplainer'
import { SeverityBadge, StatusBadge, Badge } from '../../components/ui/Badge'
import ScoreBar from '../../components/ui/ScoreBar'
import { useAuth } from '../../auth/auth-context'
import { slotsWithoutEnrolledNumber } from '../../domain/analysis'
import type { Finding } from '../../domain/analysis'
import { formatDate, formatNumber, percentage, titleCase } from '../../lib/format'

export default function Overview() {
  const { workspace, analysis, role, session } = useAuth()
  const [explained, setExplained] = useState<Finding | null>(null)

  if (!workspace || !analysis || !role || !session) return null
  const data = workspace.dataset
  const staff = role === 'admin' || role === 'estates'
  const maintainer = role === 'maintenance'
  const personal = role === 'faculty' || role === 'student'
  const myId = session.user.id
  const utilisationValues = analysis.capacity.rooms
    .map((room) => room.averageUtilisation)
    .filter((value): value is number => value !== null)
  const averageUtilisation =
    utilisationValues.length > 0
      ? utilisationValues.reduce((total, value) => total + value, 0) / utilisationValues.length
      : null

  const myReports = data.complaints.filter((complaint) => complaint.reporterId === myId)
  const myOpen = myReports.filter((complaint) => complaint.status === 'open' || complaint.status === 'in_progress')
  const myAssigned = data.complaints.filter(
    (complaint) =>
      complaint.assignedToUserId === myId && (complaint.status === 'open' || complaint.status === 'in_progress'),
  )
  const publicOpen = data.urbanIssues.filter((issue) => issue.status === 'reported' || issue.status === 'in_progress')

  const relevantFindings = analysis.findings
    .filter((finding) => {
      if (staff) return true
      if (maintainer) return finding.module === 'maintenance'
      return false
    })
    .slice(0, 6)

  const methodsFor = (module: Finding['module']) => {
    if (module === 'capacity') return analysis.capacity.methods
    if (module === 'utilities') return analysis.utilities.methods
    if (module === 'maintenance') return analysis.maintenance.methods
    if (module === 'plan') return analysis.plan.methods
    return []
  }

  const loop = staff
    ? [
        { step: 'Inventory', detail: `${data.buildings.length} buildings · ${data.rooms.length} rooms · ${data.assets.length} assets`, to: '/dashboard/inventory' },
        { step: 'Needs & gaps', detail: `${analysis.capacity.shortages.length} shortfall slot(s) · ${analysis.capacity.unassessedRooms} room(s) unscored`, to: '/dashboard/needs-gaps' },
        { step: 'Priority', detail: `${analysis.maintenance.activeCount} active complaint(s) · ${analysis.maintenance.overdueInspectionCount} overdue inspection(s)`, to: '/dashboard/issues-maintenance' },
        { step: 'Action', detail: `${analysis.plan.options.length} option(s) · ${analysis.plan.approvalCounts.approved} approved`, to: '/dashboard/plan-report' },
        { step: 'Report', detail: 'Markdown report and CSV findings export', to: '/dashboard/plan-report' },
      ]
    : maintainer
      ? [
          { step: 'Assigned work', detail: `${myAssigned.length} open item(s) assigned to you`, to: '/dashboard/issues-maintenance' },
          { step: 'Resources', detail: `${data.utilityMeters.length} meter(s) · ${analysis.utilities.missingCount} missing reading(s)`, to: '/dashboard/resources' },
          { step: 'Public infrastructure', detail: `${publicOpen.length} open public report(s)`, to: '/dashboard/issues-maintenance' },
        ]
      : [
          { step: 'Report a problem', detail: 'Rooms, fixtures, IT, safety or public infrastructure', to: '/dashboard/issues-maintenance' },
          { step: 'Track your reports', detail: `${myOpen.length} of your report(s) still open`, to: '/dashboard/issues-maintenance' },
          { step: 'Public issues', detail: `${publicOpen.length} open report(s) near the college`, to: '/dashboard/issues-maintenance' },
        ]

  return (
    <div>
      <PageHeading
        kicker="Workspace overview"
        title={`${workspace.activeCollege.name}`}
        description={
          staff
            ? 'What the recorded data shows about rooms, utilities and maintenance. Missing values stay missing, never zero.'
            : maintainer
              ? 'Your assigned maintenance work, meter readings and public infrastructure reports. Priority scores help decide what to look at first; they are not safety assessments.'
              : 'Your reports, the public infrastructure register and the rooms visible to students and faculty. Personal reports stay private to you.'
        }
      />

      {staff && (
        <div className="mb-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Critical findings"
            value={analysis.findingCounts.critical}
            detail={`${analysis.findingCounts.high} high · ${analysis.findingCounts.medium} medium`}
            tone={analysis.findingCounts.critical > 0 ? 'critical' : 'default'}
          />
          <Stat
            label="Capacity shortfall slots"
            value={analysis.capacity.shortages.length}
            detail={`${analysis.capacity.assessedRooms} room(s) scored · ${analysis.capacity.unassessedRooms} not scored`}
            tone={analysis.capacity.shortages.length > 0 ? 'high' : 'good'}
          />
          <Stat
            label="Active complaints"
            value={analysis.maintenance.activeCount}
            detail={`${analysis.maintenance.overdueInspectionCount} inspection(s) overdue`}
            tone={analysis.maintenance.overdueInspectionCount > 0 ? 'high' : 'default'}
          />
          <Stat
            label="Flagged utility spikes"
            value={analysis.utilities.spikeCount}
            detail={`${analysis.utilities.missingCount} missing reading(s) · ${analysis.utilities.resetCount} reset(s)`}
            tone={analysis.utilities.spikeCount > 0 ? 'high' : 'default'}
          />
        </div>
      )}

      {maintainer && (
        <div className="mb-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="My open assignments"
            value={myAssigned.length}
            detail="Complaints assigned to you in this college"
            tone={myAssigned.length > 0 ? 'high' : 'good'}
          />
          <Stat
            label="Overdue inspections"
            value={analysis.maintenance.overdueInspectionCount}
            detail={`${analysis.maintenance.dueSoonInspectionCount} due within 7 days`}
            tone={analysis.maintenance.overdueInspectionCount > 0 ? 'critical' : 'default'}
          />
          <Stat
            label="Missing meter readings"
            value={analysis.utilities.missingCount}
            detail="Missing values are not treated as zero consumption"
            tone={analysis.utilities.missingCount > 0 ? 'high' : 'default'}
          />
          <Stat
            label="Open public issues"
            value={publicOpen.length}
            detail="Shared register — not owned by a college"
          />
        </div>
      )}

      {personal && (
        <div className="mb-10 grid gap-4 sm:grid-cols-3">
          <Stat label="My open reports" value={myOpen.length} detail={`${myReports.length} submitted in total`} tone={myOpen.length > 0 ? 'high' : 'default'} />
          <Stat label="My resolved reports" value={myReports.filter((c) => c.status === 'resolved' || c.status === 'closed').length} detail="Resolved or closed" tone="good" />
          <Stat label="Open public issues" value={publicOpen.length} detail="Visible to everyone in the workspace" />
        </div>
      )}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-8">
          {staff || maintainer ? (
            <Panel
              kicker="What to look at first"
              title="Priority findings"
              actions={<Link to="/dashboard/needs-gaps" className="text-xs text-violet-bright underline underline-offset-4 hover:text-gold">Needs &amp; gaps →</Link>}
            >
              {relevantFindings.length === 0 ? (
                <p className="text-sm text-ivory/55">No findings were produced from the current records.</p>
              ) : (
                <ul className="divide-y divide-violet/20">
                  {relevantFindings.map((finding) => (
                    <li key={finding.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <SeverityBadge severity={finding.severity} />
                            <Badge tone="outline">{titleCase(finding.module)}</Badge>
                          </div>
                          <p className="mt-1.5 text-sm font-medium text-ivory">{finding.title}</p>
                          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ivory/55">{finding.summary}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setExplained(finding)}
                          className="shrink-0 rounded border border-violet/40 px-2.5 py-1 font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright hover:bg-violet/15 focus-ring"
                        >
                          How is this calculated?
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {!staff && (
                <p className="mt-4 border-t border-violet/20 pt-3 text-xs text-ivory/45">
                  Maintenance findings use severity, age, repeat history and asset criticality. They are a guide to
                  what to look at first, not a safety assessment.
                </p>
              )}
            </Panel>
          ) : (
            <Panel kicker="Your reports" title="Recent personal reports">
              {myReports.length === 0 ? (
                <p className="text-sm text-ivory/55">
                  You have not submitted a campus report yet. Use Issues &amp; Maintenance to report a problem.
                </p>
              ) : (
                <ul className="divide-y divide-violet/20">
                  {myReports.slice(0, 5).map((complaint) => (
                    <li key={complaint.id} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0">
                      <div>
                        <p className="text-sm text-ivory">{complaint.description}</p>
                        <p className="mt-0.5 text-xs text-ivory/50">
                          {complaint.category} · raised {formatDate(complaint.raisedAt)}
                        </p>
                      </div>
                      <StatusBadge status={complaint.status} />
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to="/dashboard/issues-maintenance"
                className="mt-4 inline-block text-xs text-violet-bright underline underline-offset-4 hover:text-gold"
              >
                Open Issues &amp; Maintenance →
              </Link>
            </Panel>
          )}

          <Panel kicker="The working loop" title={staff ? 'Evidence to decision' : 'Report, track, plan'}>
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {loop.map((item, index) => (
                <li key={item.step}>
                  <Link
                    to={item.to}
                    className="block h-full border border-violet/25 bg-ink/50 p-4 transition-colors hover:border-violet/60 hover:bg-violet/10 focus-ring"
                  >
                    <span className="font-mono text-[0.625rem] text-gold">{String(index + 1).padStart(2, '0')}</span>
                    <p className="mt-1 font-heading text-lg text-ivory">{item.step}</p>
                    <p className="mt-1 text-xs leading-relaxed text-ivory/55">{item.detail}</p>
                  </Link>
                </li>
              ))}
            </ol>
          </Panel>

          {staff && (
            <Panel kicker="Rooms under pressure" title="Latest needs scores">
              {analysis.capacity.rooms.filter((room) => room.status === 'critical' || room.status === 'stressed').length === 0 ? (
                <p className="text-sm text-ivory/55">No rooms currently score at stressed or critical.</p>
              ) : (
                <ul className="space-y-4">
                  {analysis.capacity.rooms
                    .filter((room) => room.status === 'critical' || room.status === 'stressed')
                    .slice(0, 4)
                    .map((room) => (
                      <li key={room.roomId}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-sm text-ivory">
                            {room.code} — {room.name || room.buildingName}
                          </p>
                          <p className="font-mono text-[0.625rem] uppercase tracking-widest text-ivory/45">
                            peak demand {room.expectedPeak ?? 'not recorded'} · capacity {room.capacity ?? 'not recorded'}
                          </p>
                        </div>
                        <div className="mt-1">
                          <ScoreBar
                            value={room.score}
                            thresholds={[
                              { at: 30, label: 'Stressed', className: 'bg-gold' },
                              { at: 60, label: 'Critical', className: 'bg-status-error-dark' },
                            ]}
                            compact
                          />
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </Panel>
          )}
        </div>

        <div className="space-y-8">
          <Panel kicker="Data quality" title="What the numbers can support">
            <dl className="space-y-3 text-sm">
              <div className="flex items-baseline justify-between gap-3 border-b border-violet/15 pb-2">
                <dt className="text-ivory/60">Rooms without a needs score</dt>
                <dd className="font-mono text-ivory">{analysis.capacity.unassessedRooms}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-b border-violet/15 pb-2">
                <dt className="text-ivory/60">Slots with no enrolled number</dt>
                <dd className="font-mono text-ivory">{formatNumber(slotsWithoutEnrolledNumber(data.timetableSlots))}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-b border-violet/15 pb-2">
                <dt className="text-ivory/60">Slots missing attendance records</dt>
                <dd className="font-mono text-ivory">
                  {analysis.capacity.rooms.reduce((total, room) => total + room.missingAttendanceSlots, 0)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-b border-violet/15 pb-2">
                <dt className="text-ivory/60">Utility readings missing a value</dt>
                <dd className="font-mono text-ivory">{analysis.utilities.missingCount}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ivory/60">Average recorded utilisation</dt>
                <dd className="font-mono text-ivory">{percentage(averageUtilisation, 1)}</dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-violet/20 pt-3 text-xs leading-relaxed text-ivory/45">
              Utilisation requires both actual attendance and seat capacity. When either is missing it is reported as
              not available. {formatNumber(slotsWithoutEnrolledNumber(data.timetableSlots))} slots have no enrolled
              number, so attendance cannot be logged for them yet.{' '}
              {formatNumber(data.utilityReadings.length)} utility readings and{' '}
              {formatNumber(data.timetableSlots.length)} timetable slots are in this view.
            </p>
          </Panel>

          {staff && (
            <Panel kicker="Data source" title="Where this data came from">
              <p className="text-sm leading-relaxed text-ivory/70">{workspace.provenance.notes}</p>
              <dl className="mt-4 space-y-2 font-mono text-[0.6875rem] text-ivory/50">
                <div className="flex justify-between gap-3">
                  <dt>Dataset</dt>
                  <dd className="text-right text-ivory/80">{workspace.provenance.name}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Generated</dt>
                  <dd className="text-right text-ivory/80">{formatDate(workspace.provenance.generatedAt)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>Generator</dt>
                  <dd className="text-right text-ivory/80">{workspace.provenance.generator}</dd>
                </div>
              </dl>
              <Link to="/dashboard/data-centre" className="mt-4 inline-block text-xs text-violet-bright underline underline-offset-4 hover:text-gold">
                Open Data Centre →
              </Link>
            </Panel>
          )}

          {personal && (
            <Notice tone="info" title="Privacy">
              Your campus reports are visible only to you and to the staff who resolve them. Public infrastructure
              reports are shared with all signed-in users. Rooms and buildings are read-only for your role.
            </Notice>
          )}

          {maintainer && (
            <Notice tone="info" title="Your scope">
              You only see complaints assigned to you, the meter readings for this college and the shared public
              register. Ask estates if work is missing from your queue.
            </Notice>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(explained)}
        onClose={() => setExplained(null)}
        title="How this is calculated"
        description="The records and rules behind this finding, what they cannot tell you, and an optional written summary."
        size="lg"
      >
        {explained && <FindingExplainer finding={explained} methods={methodsFor(explained.module)} />}
      </Modal>
    </div>
  )
}
