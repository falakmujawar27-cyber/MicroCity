import { useState } from 'react'
import { Link } from 'react-router-dom'
import PageHeading from '../../components/dashboard/PageHeading'
import Panel from '../../components/ui/Panel'
import Stat from '../../components/ui/Stat'
import Modal from '../../components/ui/Modal'
import FindingExplainer from '../../components/dashboard/FindingExplainer'
import { SeverityBadge, Badge } from '../../components/ui/Badge'
import { useAuth } from '../../auth/auth-context'
import { isCriticalGapItem, slotsWithoutEnrolledNumber } from '../../domain/analysis'
import type { Finding } from '../../domain/analysis'
import { formatDateTime, formatNumber, titleCase } from '../../lib/format'

/** The first sentence keeps each priority row to one line of reason. */
function oneLine(text: string): string {
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text
  return first.length > 120 ? `${first.slice(0, 117).trimEnd()}…` : first
}

function actionFor(finding: Finding): { label: string; to: string } {
  if (finding.module === 'capacity' || finding.module === 'plan') {
    return { label: 'Create plan', to: '/dashboard/plan-report' }
  }
  return { label: 'Assign', to: '/dashboard/issues-maintenance' }
}

export default function Overview() {
  const { workspace, analysis, role, session } = useAuth()
  const [explained, setExplained] = useState<Finding | null>(null)
  const [missingOpen, setMissingOpen] = useState(false)

  if (!workspace || !analysis || !role || !session) return null
  const data = workspace.dataset

  const methodsFor = (module: Finding['module']) => {
    if (module === 'capacity') return analysis.capacity.methods
    if (module === 'utilities') return analysis.utilities.methods
    if (module === 'maintenance') return analysis.maintenance.methods
    if (module === 'plan') return analysis.plan.methods
    return []
  }

  const criticalGaps = analysis.gaps.filter(isCriticalGapItem).length
  const openIssues =
    data.complaints.filter((complaint) => complaint.status === 'open' || complaint.status === 'in_progress').length +
    data.urbanIssues.filter((issue) => issue.status === 'reported' || issue.status === 'in_progress').length
  const decisionsWaiting = analysis.plan.approvalCounts.none + analysis.plan.approvalCounts.proposed

  const urgent = analysis.gaps
    .filter((finding) => finding.severity === 'critical' || finding.severity === 'high')
    .slice(0, 3)

  const slotsMissingAttendance = data.timetableSlots.filter((slot) => slot.attendance === null)
  const slotsMissingEnrolled = slotsWithoutEnrolledNumber(data.timetableSlots)
  const roomsById = new Map(data.rooms.map((room) => [room.id, room]))

  const loop = [
    {
      step: 'Inventory',
      detail: `${formatNumber(data.buildings.length)} buildings`,
      to: '/dashboard/inventory',
    },
    { step: 'Needs', detail: '5 categories', to: '/dashboard/needs-gaps' },
    {
      step: 'Priority',
      detail: `${formatNumber(analysis.maintenance.ranked.length)} ranked`,
      to: '/dashboard/issues-maintenance',
    },
    {
      step: 'Action',
      detail: `${formatNumber(data.planOptions.length)} plan · ${formatNumber(decisionsWaiting)} waiting`,
      to: '/dashboard/plan-report',
    },
    { step: 'Report', detail: 'Download', to: '/dashboard/plan-report' },
  ]

  return (
    <div>
      <PageHeading
        kicker="Module 00 — Overview"
        title="Overview"
        description="The three numbers that need attention, the work that should move first, and the loop that turns records into a report."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Critical gaps"
          value={formatNumber(criticalGaps)}
          detail="Campus and nearby gap items; public issues are counted under Open issues."
          tone={criticalGaps > 0 ? 'critical' : 'default'}
        />
        <Stat
          label="Open issues"
          value={formatNumber(openIssues)}
          detail="Campus complaints with status Open or In progress, plus public issues Reported or In progress."
          tone={openIssues > 0 ? 'high' : 'default'}
        />
        <Stat
          label="Decisions waiting"
          value={formatNumber(decisionsWaiting)}
          detail="Plan options with no administrator decision, plus proposals still waiting for one."
          tone={decisionsWaiting > 0 ? 'high' : 'default'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <Panel kicker="Priority" title="Fix these first">
          {urgent.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ivory/60">No critical or high finding is waiting for action.</p>
              <Link
                to="/dashboard/needs-gaps"
                className="rounded-md border border-violet/40 px-3 py-2 text-sm font-semibold text-ivory/85 hover:bg-violet/15 focus-ring"
              >
                Review Needs and Gaps
              </Link>
            </div>
          ) : (
            <ol className="divide-y divide-violet/20">
              {urgent.map((finding) => {
                const nearby = analysis.nearby.find((row) => row.type === finding.facts.nearbyType)
                const nearbyAsset = nearby?.records.find((asset) => asset.condition === 'poor' || asset.condition === 'fair')
                const action = nearbyAsset ? {
                  label: `Report to ${nearbyAsset.responsibleAuthority}`,
                  to: `/dashboard/issues-maintenance?nearbyAsset=${encodeURIComponent(nearbyAsset.id)}`,
                } : actionFor(finding)
                return (
                  <li key={finding.id} className="flex flex-col items-start gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={finding.severity} />
                        <span className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">
                          {nearby ? 'Nearby area' : titleCase(finding.module)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold leading-snug text-ivory">{finding.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-ivory/60">{oneLine(finding.summary)}</p>
                      {finding.noPlanYet && <p className="mt-1 text-xs text-ivory/55">No plan yet</p>}
                    </div>
                    {/* Stacks under the text at narrow widths (360px) instead of squeezing beside it. */}
                    <div className="flex max-w-full flex-wrap items-center gap-2">
                      {nearby ? (
                        <Link to={`/dashboard/needs-gaps?area=nearby&type=${nearby.type}`} className="rounded-md border border-violet/40 px-3 py-2 text-xs font-semibold text-ivory/85 hover:bg-violet/15 focus-ring">Why?</Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setExplained(finding)}
                          className="rounded-md border border-violet/40 px-3 py-2 text-xs font-semibold text-ivory/85 hover:bg-violet/15 focus-ring"
                        >
                          Why?
                        </button>
                      )}
                      <Link
                        to={action.to}
                        className="rounded-md bg-violet px-3 py-2 text-xs font-semibold text-ivory hover:bg-violet/85 focus-ring"
                      >
                        {action.label}
                      </Link>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </Panel>

        <div className="space-y-6">
          <Panel kicker="Workflow" title="The loop">
            <ol className="space-y-2">
              {loop.map((item, index) => (
                <li key={item.step} className="flex items-baseline justify-between gap-3 border-b border-violet/15 pb-2 last:border-b-0 last:pb-0">
                  <span className="flex min-w-0 items-baseline gap-3">
                    <span aria-hidden="true" className="font-mono text-[0.625rem] text-gold/70">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <Link to={item.to} className="text-sm text-ivory/85 underline decoration-violet/40 underline-offset-2 hover:text-ivory focus-ring">
                      {item.step}
                    </Link>
                  </span>
                  <span className="shrink-0 text-right text-xs text-ivory/55">{item.detail}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel kicker="Evidence quality" title="Missing data">
            <div className="space-y-3 text-sm leading-relaxed text-ivory/70">
              <div>
                <p className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">
                  Lecture slots with no attendance
                </p>
                <p className="mt-1">
                  <span className="font-semibold text-ivory">{formatNumber(slotsMissingAttendance.length)}</span>{' '}
                  lecture slots have no attendance.
                </p>
              </div>
              <div>
                <p className="font-mono text-[0.5625rem] uppercase tracking-widest text-ivory/40">
                  Slots with no enrolled number
                </p>
                <p className="mt-1">
                  <span className="font-semibold text-ivory">{formatNumber(slotsMissingEnrolled)}</span>{' '}
                  slots have no enrolled number.
                </p>
              </div>
              <p className="text-xs text-ivory/45">
                Utilisation and the Needs status cannot use these sessions until they are filled. Missing is shown as
                missing, never as zero.
              </p>
            </div>
            {slotsMissingAttendance.length > 0 ? (
              <button
                type="button"
                onClick={() => setMissingOpen(true)}
                className="mt-4 w-full rounded-md border border-violet/40 px-3 py-2 text-sm font-semibold text-ivory/85 hover:bg-violet/15 focus-ring"
              >
                Ask faculty to log
              </button>
            ) : (
              <p className="mt-4 border-t border-violet/20 pt-3 text-xs text-ivory/45">
                Every recorded lecture slot has attendance.
              </p>
            )}
          </Panel>
        </div>
      </div>

      <Modal
        open={Boolean(explained)}
        onClose={() => setExplained(null)}
        title="Why this is on the list"
        description="The recorded evidence, the rules used, and what the finding cannot tell you."
        size="lg"
      >
        {explained && <FindingExplainer finding={explained} methods={methodsFor(explained.module)} />}
      </Modal>

      <Modal
        open={missingOpen}
        onClose={() => setMissingOpen(false)}
        title="Slots with no attendance"
        description="Read-only list. MicroCity does not send messages or notifications; share this list with faculty yourself."
        size="lg"
      >
        {slotsMissingAttendance.length === 0 ? (
          <p className="text-sm text-ivory/60">No lecture slot is missing attendance.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="border-b border-violet/30 font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Session</th>
                  <th scope="col" className="px-3 py-2 font-medium">Room</th>
                  <th scope="col" className="px-3 py-2 font-medium">Starts (IST)</th>
                  <th scope="col" className="px-3 py-2 font-medium">Enrolled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-violet/20">
                {slotsMissingAttendance.map((slot) => (
                  <tr key={slot.id}>
                    <td className="px-3 py-2 text-ivory/85">{slot.activity}</td>
                    <td className="px-3 py-2 text-ivory/70">
                      {roomsById.get(slot.roomId)?.code ?? 'Room not recorded'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ivory/60">{formatDateTime(slot.startsAt)}</td>
                    <td className="px-3 py-2 font-mono text-ivory/70">
                      {slot.expectedAttendance === null ? (
                        <Badge tone="warn">Not enrolled</Badge>
                      ) : (
                        formatNumber(slot.expectedAttendance)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  )
}
