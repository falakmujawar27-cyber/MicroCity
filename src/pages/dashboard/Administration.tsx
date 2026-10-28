import { useState } from 'react'
import type { FormEvent } from 'react'
import PageHeading from '../../components/dashboard/PageHeading'
import Panel from '../../components/ui/Panel'
import Notice from '../../components/ui/Notice'
import { Badge } from '../../components/ui/Badge'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../auth/auth-context'
import { ALL_ROLES, hasCapability } from '../../domain/permissions'
import type { Capability } from '../../domain/permissions'
import { ROLE_LABELS } from '../../domain/types'
import type { UserRole } from '../../domain/types'

const CAPABILITIES: { key: Capability; label: string; description: string }[] = [
  { key: 'submit-complaints', label: 'Submit reports', description: 'Raise campus complaints and public infrastructure issues' },
  { key: 'view-all-complaints', label: 'View all reports', description: 'See every campus complaint in the college' },
  { key: 'view-assigned-only', label: 'Assigned work only', description: 'Maintenance sees only complaints assigned to them' },
  { key: 'assign-complaints', label: 'Assign work', description: 'Assign complaints and change status across the college' },
  { key: 'manage-inventory', label: 'Manage inventory', description: 'Create/edit buildings, rooms, assets, meters, readings, tariffs, inspections, options' },
  { key: 'view-resources', label: 'View resources', description: 'Electricity and water readings, trends and anomalies' },
  { key: 'view-plan', label: 'View plan', description: 'Plan options, costs, decisions and reports' },
  { key: 'approve-decisions', label: 'Approve decisions', description: 'Record approved / rejected / deferred plan decisions' },
  { key: 'manage-urban-assets', label: 'Manage public assets', description: 'Create/delete shared public infrastructure assets' },
  { key: 'update-urban-issues', label: 'Update public issues', description: 'Change status and notes on public infrastructure issues' },
  { key: 'import-data', label: 'Import data', description: 'Validate and apply CSV/Excel imports' },
  { key: 'manage-users', label: 'Manage roles', description: 'Grant administrator, estates, maintenance, faculty or student membership roles' },
  { key: 'view-audit', label: 'View audit', description: 'Review the workspace audit trail and import history' },
]

export default function Administration() {
  const { session, workspace, ai, refresh, can } = useAuth()
  const [roleEdits, setRoleEdits] = useState<Record<string, UserRole>>({})
  const [savingMember, setSavingMember] = useState<string | null>(null)
  const [memberError, setMemberError] = useState<string | null>(null)
  const [memberSaved, setMemberSaved] = useState<string | null>(null)
  const [staff, setStaff] = useState({
    displayName: '',
    username: '',
    password: '',
    role: 'maintenance' as 'admin' | 'estates' | 'maintenance',
  })
  const [staffBusy, setStaffBusy] = useState(false)
  const [staffError, setStaffError] = useState<string | null>(null)
  const [staffSaved, setStaffSaved] = useState<string | null>(null)

  if (!workspace || !session) return null

  const canManageUsers = can('manage-users')

  const saveRole = async (userId: string) => {
    const nextRole = roleEdits[userId]
    if (!nextRole) return
    setSavingMember(userId)
    setMemberError(null)
    setMemberSaved(null)
    try {
      await api.updateMemberRole(userId, nextRole)
      setRoleEdits((current) => {
        const copy = { ...current }
        delete copy[userId]
        return copy
      })
      setMemberSaved(userId)
      await refresh()
    } catch (error) {
      setMemberError(error instanceof ApiError ? error.message : 'The role was not changed.')
    } finally {
      setSavingMember(null)
    }
  }

  const createStaff = async (event: FormEvent) => {
    event.preventDefault()
    setStaffBusy(true)
    setStaffError(null)
    setStaffSaved(null)
    try {
      await api.createMember(staff)
      setStaffSaved(`Created ${staff.displayName || staff.username} as ${ROLE_LABELS[staff.role]}.`)
      setStaff({ displayName: '', username: '', password: '', role: 'maintenance' })
      await refresh()
    } catch (error) {
      setStaffError(error instanceof ApiError ? error.message : 'The account was not created.')
    } finally {
      setStaffBusy(false)
    }
  }

  return (
    <div>
      <PageHeading
        kicker="Administration"
        title="Access, accounts and assistant"
        description="Role permissions, college members and the optional AI assistant. This page is available to administrators only."
      />

      <div className="mb-8 grid gap-5 lg:grid-cols-2">
        <Panel kicker="College administration" title="Members and roles">
          {memberError && <div className="mb-4"><Notice tone="danger">{memberError}</Notice></div>}
          {memberSaved && (
            <Notice tone="success" className="mb-4">
              Role updated. The affected user's next request is authorised with the new role.
            </Notice>
          )}
          {workspace.members.length === 0 ? (
            <Notice tone="info">No members are listed for this college.</Notice>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="border-b border-violet/30 font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Member</th>
                    <th scope="col" className="px-3 py-2 font-medium">Current role</th>
                    <th scope="col" className="px-3 py-2 font-medium">Change role</th>
                    <th scope="col" className="px-3 py-2 font-medium">Save</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-violet/20">
                  {workspace.members.map((member) => {
                    const isSelf = member.id === session.user.id
                    const draft = roleEdits[member.id]
                    const changed = draft !== undefined && draft !== member.role
                    return (
                      <tr key={member.id}>
                        <td className="px-3 py-2.5">
                          <span className="text-ivory/85">{member.displayName}</span>
                          {isSelf && <span className="ml-2 text-[0.625rem] uppercase tracking-wider text-gold">you</span>}
                          {member.sample && <span className="ml-2"><Badge tone="outline">sample</Badge></span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={member.role === 'admin' ? 'violet' : 'neutral'}>{ROLE_LABELS[member.role]}</Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          {canManageUsers ? (
                            <select
                              aria-label={`Role for ${member.displayName}`}
                              value={draft ?? member.role}
                              onChange={(event) => {
                                setMemberSaved(null)
                                setRoleEdits((current) => ({ ...current, [member.id]: event.target.value as UserRole }))
                              }}
                              className="w-full min-w-40 rounded-md border border-violet/35 bg-obsidian px-2 py-1.5 text-sm text-ivory focus-ring"
                            >
                              {ALL_ROLES.map((item) => (
                                <option key={item} value={item} disabled={isSelf && item !== 'admin'}>
                                  {ROLE_LABELS[item]}
                                  {isSelf && item !== 'admin' ? ' — cannot remove own admin' : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-ivory/45">Admin only</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {canManageUsers && (
                            <button
                              type="button"
                              onClick={() => void saveRole(member.id)}
                              disabled={!changed || savingMember === member.id}
                              className="rounded-md border border-violet/40 px-3 py-1.5 text-xs text-ivory/85 hover:bg-violet/15 focus-ring disabled:opacity-40"
                            >
                              {savingMember === member.id ? 'Saving…' : 'Save role'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 border-t border-violet/25 pt-3 text-xs leading-relaxed text-ivory/55">
            Role changes are recorded in the audit trail with actor and time. Students and faculty create their own
            accounts with the college code; staff accounts are created by an administrator below.
          </p>

          {canManageUsers && (
            <form onSubmit={createStaff} className="mt-5 border-t border-violet/25 pt-4">
              <h3 className="font-heading text-base font-semibold text-ivory">Create a staff account</h3>
              <p className="mt-1 text-xs leading-relaxed text-ivory/60">
                Maintenance, estates and administrator accounts can only be created here.
              </p>
              {staffError && <div className="mt-3"><Notice tone="danger">{staffError}</Notice></div>}
              {staffSaved && <div className="mt-3"><Notice tone="success">{staffSaved}</Notice></div>}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-ivory/70">
                  Full name
                  <input
                    value={staff.displayName}
                    onChange={(event) => setStaff((current) => ({ ...current, displayName: event.target.value }))}
                    required
                    minLength={2}
                    maxLength={80}
                    className="mt-1 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                  />
                </label>
                <label className="block text-xs text-ivory/70">
                  Username
                  <input
                    value={staff.username}
                    onChange={(event) => setStaff((current) => ({ ...current, username: event.target.value }))}
                    required
                    pattern="[A-Za-z0-9._-]{3,32}"
                    className="mt-1 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                  />
                </label>
                <label className="block text-xs text-ivory/70">
                  Temporary password
                  <input
                    type="password"
                    value={staff.password}
                    onChange={(event) => setStaff((current) => ({ ...current, password: event.target.value }))}
                    required
                    minLength={10}
                    autoComplete="new-password"
                    className="mt-1 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                  />
                </label>
                <label className="block text-xs text-ivory/70">
                  Role
                  <select
                    value={staff.role}
                    onChange={(event) =>
                      setStaff((current) => ({
                        ...current,
                        role: event.target.value as 'admin' | 'estates' | 'maintenance',
                      }))
                    }
                    className="mt-1 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                  >
                    <option value="maintenance">{ROLE_LABELS.maintenance}</option>
                    <option value="estates">{ROLE_LABELS.estates}</option>
                    <option value="admin">{ROLE_LABELS.admin}</option>
                  </select>
                </label>
              </div>
              <button
                type="submit"
                disabled={staffBusy}
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-violet px-4 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:opacity-50"
              >
                {staffBusy ? 'Creating account…' : 'Create staff account'}
              </button>
            </form>
          )}
        </Panel>

        <Panel kicker="Optional assistant" title="AI status">
          {ai === null ? (
            <Notice tone="warning" title="Status unavailable">
              The server did not return AI configuration status. All calculations and rule-based explanations remain
              available without it.
            </Notice>
          ) : ai.configured ? (
            <Notice tone="success" title="Configured on the server">
              The assistant is enabled with model <span className="font-mono text-ivory/85">{ai.model ?? 'unknown'}</span>.
              Requests are proxied by the server; the API key is never sent to the browser.
            </Notice>
          ) : (
            <Notice tone="info" title="Not configured">
              No AI credentials are configured on the server. Every calculation, finding, priority and report is
              still produced without AI. Rule-based explanations are labelled as such.
            </Notice>
          )}
          <div className="mt-4 space-y-3 text-sm text-ivory/70">
            <p>
              Configuration uses server-side environment variables:{' '}
              <span className="font-mono text-ivory/85">AI_BASE_URL</span>,{' '}
              <span className="font-mono text-ivory/85">AI_API_KEY</span>,{' '}
              <span className="font-mono text-ivory/85">AI_MODEL</span> and optional{' '}
              <span className="font-mono text-ivory/85">AI_API_URL</span>. No key is present in client code or
              browser storage.
            </p>
            <p className="border-t border-violet/25 pt-3 text-xs leading-relaxed text-ivory/55">
              AI output is always labelled “AI-generated — please verify”. The assistant explains supplied figures;
              it cannot create, approve, assign, delete or authorise anything.
            </p>
          </div>
        </Panel>
      </div>

      <Panel
        kicker="Access control"
        title="Role capability matrix"
        className="mb-8"
        actions={<Badge tone="outline">Enforced by the API</Badge>}
      >
        <p className="max-w-3xl text-sm leading-relaxed text-ivory/70">
          The interface hides actions your role cannot perform, but hiding is not the control: every request is
          authorised again by the server against this matrix. Only an administrator can grant or change roles.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-violet/30 font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Capability</th>
                {ALL_ROLES.map((item) => (
                  <th key={item} scope="col" className="px-3 py-2 text-center font-medium">
                    {ROLE_LABELS[item]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-violet/20">
              {CAPABILITIES.map((capability) => (
                <tr key={capability.key}>
                  <th scope="row" className="px-3 py-2 font-normal">
                    <span className="block text-ivory/85">{capability.label}</span>
                    <span className="block text-xs text-ivory/45">{capability.description}</span>
                  </th>
                  {ALL_ROLES.map((item) => {
                    const allowed = hasCapability(item, capability.key)
                    return (
                      <td key={item} className="px-3 py-2 text-center">
                        <span
                          className={allowed ? 'text-status-ok-dark' : 'text-ivory/25'}
                          aria-label={`${ROLE_LABELS[item]}: ${allowed ? 'allowed' : 'not allowed'}`}
                          title={`${ROLE_LABELS[item]}: ${allowed ? 'allowed' : 'not allowed'}`}
                        >
                          {allowed ? '✓' : '—'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-ivory/55">
          <span><span className="text-status-ok-dark">✓</span> permitted</span>
          <span><span className="text-ivory/30">—</span> not permitted</span>
          <span>Approval of plan decisions: administrator only.</span>
        </div>
      </Panel>

      <div className="mt-8">
        <Panel kicker="Security" title="Controls in this build">
          <ul className="space-y-3 text-sm leading-relaxed text-ivory/70">
            <li>Passwords are hashed with scrypt; sessions use an HTTP-only, SameSite=Lax cookie and hashed tokens.</li>
            <li>College isolation and record-level ownership are checked server-side on every request.</li>
            <li>Students and faculty see only their own private reports. Maintenance sees only assigned work.</li>
            <li>Only administrators approve decisions, delete records, manage public assets or change roles.</li>
            <li>AI credentials stay in server environment variables; the browser only receives configured/model status.</li>
            <li>
              This is a local demonstration build served over HTTP. Before any real deployment, add HTTPS, a
              production database backup/restore procedure, secret management and an independent security review.
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  )
}
