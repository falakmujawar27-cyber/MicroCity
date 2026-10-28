import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/auth-context'
import { ROLE_LABELS } from '../../domain/types'
import { dashboardNavFor } from './nav'

function PersonalLoading() {
  return (
    <div className="border border-violet/30 bg-obsidian px-5 py-8">
      <p className="font-mono text-xs uppercase tracking-widest text-violet-bright">Loading your workspace…</p>
      <p className="mt-2 text-sm text-ivory/60">Reading your college records.</p>
    </div>
  )
}

/**
 * Mobile-first shell for students, faculty and the maintenance technician.
 * Three navigation items for a student and a technician, four for faculty, and
 * never more than five. The report wizard runs without the bottom bar so it can
 * use the full screen for its three steps.
 */
export default function PersonalShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { session, workspace, role, error, refresh, signOut, switchCollege, loadingWorkspace } = useAuth()
  const [busy, setBusy] = useState(false)

  const items = dashboardNavFor(role)
  const bare = pathname === '/dashboard/report'
  const college = workspace?.activeCollege
  const memberships = session?.memberships ?? []

  const retry = async () => {
    setBusy(true)
    await refresh()
    setBusy(false)
  }

  const leave = async () => {
    setBusy(true)
    navigate('/', { replace: true })
    await signOut()
  }

  if (error && !workspace) {
    return (
      <div className="theme-workspace grid min-h-screen place-items-center bg-ink px-4">
        <div className="w-full max-w-md border border-violet/40 bg-obsidian px-5 py-8">
          <p className="font-mono text-xs uppercase tracking-widest text-gold">Workspace unavailable</p>
          <h1 className="mt-2 font-heading text-2xl text-ivory">Your college records could not be loaded</h1>
          <p className="mt-3 text-sm leading-relaxed text-ivory/70">{error}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void retry()}
              disabled={busy || loadingWorkspace}
              className="rounded-md bg-violet px-4 py-2.5 text-sm font-semibold text-ivory disabled:opacity-50"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => void leave()}
              className="rounded-md border border-violet/40 px-4 py-2.5 text-sm text-ivory/80 hover:bg-violet/15"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!workspace || !role) {
    return (
      <div className="theme-workspace min-h-screen bg-ink">
        <main className="mx-auto w-full max-w-3xl px-4 py-8">
          <PersonalLoading />
        </main>
      </div>
    )
  }

  return (
    <div className="theme-workspace min-h-screen bg-ink">
      {!bare && (
        <header className="sticky top-0 z-30 border-b border-violet/30 bg-obsidian">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-heading text-lg font-semibold tracking-tight text-ivory">MicroCity</p>
              <p className="truncate font-mono text-[0.625rem] uppercase tracking-widest text-gold">
                {ROLE_LABELS[role]} · {college?.name ?? ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {memberships.length > 1 && (
                <label>
                  <span className="sr-only">Active college</span>
                  <select
                    value={college?.id ?? ''}
                    onChange={(event) => void switchCollege(event.target.value)}
                    className="max-w-32 rounded-md border border-violet/40 bg-obsidian px-2 py-2 text-xs text-ivory"
                  >
                    {memberships.map((membership) => (
                      <option key={membership.collegeId} value={membership.collegeId}>
                        {membership.collegeName}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                onClick={() => void leave()}
                disabled={busy}
                className="rounded-md border border-violet/40 px-3 py-2 text-xs font-semibold text-ivory/80 hover:bg-violet/15 disabled:opacity-50"
              >
                {busy ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </div>
        </header>
      )}

      <main className={`mx-auto w-full max-w-3xl px-4 pt-6 ${bare ? 'pb-10' : 'pb-28'}`}>
        <Outlet />
      </main>

      {!bare && (
        <nav
          aria-label="Your MicroCity pages"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-violet/30 bg-obsidian pb-[env(safe-area-inset-bottom)]"
        >
          <ul className={`mx-auto grid w-full max-w-3xl ${items.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
            {items.map((item) => (
              <li key={item.path} className="min-w-0">
                <NavLink
                  to={item.path}
                  end={item.path === '/dashboard'}
                  title={item.hint}
                  className={({ isActive }) =>
                    `flex min-h-14 flex-col items-center justify-center whitespace-nowrap border-t-2 px-1 py-2 text-center text-[0.6875rem] leading-tight focus-ring ${
                      isActive
                        ? 'border-violet bg-violet/10 font-semibold text-ivory'
                        : 'border-transparent text-ivory/60 hover:bg-violet/5 hover:text-ivory'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
