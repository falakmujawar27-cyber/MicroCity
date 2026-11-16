import { Link } from 'react-router-dom'
import PageHeading from '../../components/dashboard/PageHeading'
import Panel from '../../components/ui/Panel'
import Notice from '../../components/ui/Notice'
import { Badge } from '../../components/ui/Badge'
import { useAuth } from '../../auth/auth-context'
import { hasCapability } from '../../domain/permissions'
import type { Capability } from '../../domain/permissions'
import { ROLE_LABELS } from '../../domain/types'

const ROLE_HELP: { key: Capability; label: string }[] = [
  { key: 'submit-complaints', label: 'Raise campus complaints and public infrastructure issues' },
  { key: 'view-all-complaints', label: 'See every campus report in the college' },
  { key: 'view-assigned-only', label: 'See and update the work assigned to you' },
  { key: 'assign-complaints', label: 'Assign work and change report status' },
  { key: 'manage-inventory', label: 'Manage buildings, rooms, assets, meters, tariffs and inspections' },
  { key: 'view-resources', label: 'Read electricity and water use and cost estimates' },
  { key: 'view-plan', label: 'Read plan options, decisions and reports' },
  { key: 'approve-decisions', label: 'Approve, reject or defer plan decisions' },
  { key: 'manage-urban-assets', label: 'Manage shared public infrastructure assets' },
  { key: 'update-urban-issues', label: 'Update the status of public infrastructure issues' },
  { key: 'import-data', label: 'Import records from a spreadsheet' },
  { key: 'manage-users', label: 'Change college members and roles' },
  { key: 'view-audit', label: 'Read the workspace audit trail' },
]

export default function Support() {
  const { session, workspace, role } = useAuth()

  if (!workspace || !session || !role) return null

  if (role === 'student' || role === 'faculty') {
    const tasks =
      role === 'faculty'
        ? [
            'Report a campus problem in three short steps.',
            'Follow every report you made under My reports.',
            'Log attendance for a timetable session and add a quick reason when something affected the class.',
            'Report a public issue near campus; it is visible inside this college.',
          ]
        : [
            'Report a campus problem in three short steps.',
            'Follow every report you made under My reports.',
            'Report a public issue near campus; it is visible inside this college.',
          ]

    return (
      <div>
        <PageHeading
          kicker="Help"
          title="Using MicroCity"
          description="Your account, what you can do, and how to read the figures you see."
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel kicker="Your account" title="Signed-in details">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Name</dt>
                <dd className="mt-1 text-ivory/85">{session.user.displayName}</dd>
              </div>
              <div>
                <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Username</dt>
                <dd className="mt-1 font-mono text-ivory/85">{session.user.username}</dd>
              </div>
              <div>
                <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">College</dt>
                <dd className="mt-1 text-ivory/85">{workspace.activeCollege.name}</dd>
              </div>
              <div>
                <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Your role</dt>
                <dd className="mt-1 text-ivory/85">{ROLE_LABELS[role]}</dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-violet/25 pt-3 text-xs leading-relaxed text-ivory/55">
              Campus reports are visible only to you and the staff who resolve them. Public issues are shared with
              every college.
            </p>
          </Panel>

          <Panel kicker="Your pages" title="What you can do here">
            <ul className="space-y-2 text-sm leading-relaxed text-ivory/75">
              {tasks.map((task) => <li key={task}>• {task}</li>)}
            </ul>
            <p className="mt-4 border-t border-violet/25 pt-3 text-xs leading-relaxed text-ivory/55">
              Permissions are checked again by the server on every request. Ask an administrator in your college if
              you need more access.
            </p>
          </Panel>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Panel kicker="Reading the numbers" title="What each figure means">
            <ul className="space-y-3 text-sm leading-relaxed text-ivory/70">
              <li>
                <span className="text-gold">Missing is not zero.</span> If a figure was not recorded, the screen says
                so instead of treating it as zero.
              </li>
              <li>
                <span className="text-gold">Report progress.</span> Reported, Assigned, In progress and Fixed show the
                last recorded step. The bold step is where the report is now.
              </li>
              <li>
                <span className="text-gold">Demo data.</span> The starting workspace is fictional demonstration data.
              </li>
            </ul>
          </Panel>

          <Panel kicker="Optional assistant" title="How AI is used">
            <Notice tone="info">
              The optional assistant may suggest a category and room for a report when it is configured. It never
              submits the report, and any AI text is labelled “AI-generated, please verify”.
            </Notice>
            <p className="mt-4 text-xs leading-relaxed text-ivory/55">
              Reporting works without AI. If AI is not configured, the suggestion button is not shown and nothing is
              sent anywhere.
            </p>
          </Panel>
        </div>
      </div>
    )
  }

  const allowed = ROLE_HELP.filter((item) => hasCapability(role, item.key))

  return (
    <div>
      <PageHeading
        kicker="Help"
        title="Using MicroCity"
        description="A short guide to your account, what your role can do, and how to read the numbers on each screen."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel kicker="Your account" title="Signed-in details">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Name</dt>
              <dd className="mt-1 text-ivory/85">{session.user.displayName}</dd>
            </div>
            <div>
              <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Username</dt>
              <dd className="mt-1 font-mono text-ivory/85">{session.user.username}</dd>
            </div>
            <div>
              <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">College</dt>
              <dd className="mt-1 text-ivory/85">{workspace.activeCollege.name}</dd>
            </div>
            <div>
              <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Your role</dt>
              <dd className="mt-1 text-ivory/85">{ROLE_LABELS[role]}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Colleges you belong to</dt>
              <dd className="mt-1 flex flex-wrap gap-2">
                {session.memberships.map((membership) => (
                  <Badge key={membership.collegeId} tone={membership.collegeId === workspace.activeCollege.id ? 'violet' : 'outline'} wrap>
                    {membership.collegeName} · {ROLE_LABELS[membership.role]}
                  </Badge>
                ))}
              </dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-violet/25 pt-3 text-xs leading-relaxed text-ivory/55">
            Each college keeps its own records. Switching college changes which records you see; it does not change
            your role.
          </p>
        </Panel>

        <Panel kicker="Your role" title="What you can do here">
          {allowed.length === 0 ? (
            <p className="text-sm text-ivory/60">No actions are available for this role.</p>
          ) : (
            <ul className="space-y-2 text-sm leading-relaxed text-ivory/75">
              {allowed.map((item) => <li key={item.key}>• {item.label}</li>)}
            </ul>
          )}
          <p className="mt-4 border-t border-violet/25 pt-3 text-xs leading-relaxed text-ivory/55">
            If you need more access, ask an administrator in your college. Permissions are checked again by the
            server on every request.
          </p>
          {role === 'admin' && (
            <Link
              to="/dashboard/administration"
              className="mt-4 inline-flex rounded-md border border-violet/40 px-3 py-1.5 text-xs text-ivory/85 hover:bg-violet/15 focus-ring"
            >
              Open administration
            </Link>
          )}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel kicker="Reading the numbers" title="What each figure means">
          <ul className="space-y-3 text-sm leading-relaxed text-ivory/70">
            <li>
              <span className="text-gold">Missing is not zero.</span> If a room capacity or a meter reading was not
              recorded, the screen says so instead of treating it as zero.
            </li>
            <li>
              <span className="text-gold">Measured, estimated or illustrative.</span> Costs from tariffs are estimates.
              Figures copied from a spreadsheet are imported records, not verified measurements.
            </li>
            <li>
              <span className="text-gold">Public issues are shared.</span> Nearby roads, footpaths, lighting and bus
              stops are visible to every college; campus records stay inside your college.
            </li>
            <li>
              <span className="text-gold">Demo data.</span> The starting workspace is fictional demonstration data.
              Anything you import is marked as user-supplied.
            </li>
          </ul>
        </Panel>

        <Panel kicker="Optional assistant" title="How AI is used">
          <Notice tone="info">
            The optional assistant explains numbers the server has already calculated. It never calculates,
            approves, assigns or deletes anything, and any AI text is labelled “AI-generated, please verify”.
          </Notice>
          <p className="mt-4 text-xs leading-relaxed text-ivory/55">
            All calculations and rule-based explanations work without AI. If AI is not configured, nothing is sent
            anywhere.
          </p>
        </Panel>
      </div>
    </div>
  )
}
