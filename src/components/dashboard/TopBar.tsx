import { useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { dashboardMoreNavFor, dashboardNavFor, navLabelFor } from './nav'
import { useAuth } from '../../auth/auth-context'
import { ROLE_LABELS } from '../../domain/types'

interface TopBarProps {
  onMenuClick: () => void
}

export default function TopBar({ onMenuClick }: TopBarProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { session, workspace, role, signOut, switchCollege } = useAuth()
  const [signingOut, setSigningOut] = useState(false)
  const [switching, setSwitching] = useState(false)
  const current = navLabelFor(
    [...dashboardNavFor(role), ...dashboardMoreNavFor(role)],
    pathname,
  )
  const isAdmin = role === 'admin'
  const memberships = session?.memberships ?? []
  const activeId = workspace?.activeCollege.id ?? ''

  const handleSignOut = async () => {
    setSigningOut(true)
    // Leave the protected route before the session clears, otherwise the
    // route guard redirects to /signin instead of the landing page.
    navigate('/', { replace: true })
    await signOut()
  }

  const handleCollege = async (collegeId: string) => {
    setSwitching(true)
    try {
      await switchCollege(collegeId)
    } finally {
      setSwitching(false)
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-violet/30 bg-ink">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-6 py-3.5 md:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ivory hover:bg-violet/20 lg:hidden focus-ring"
            aria-label="Open navigation menu"
            aria-haspopup="dialog"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="break-words font-heading text-lg font-semibold tracking-tight text-ivory">
            {current}
          </span>
          <span
            className="inline-flex items-center gap-1.5 border border-gold/50 px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-widest text-gold"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 bg-gold" />
            {workspace?.activeCollege.mode === 'pilot'
              ? 'Pilot: illustrative data'
              : workspace?.provenance.synthetic
                ? 'Demo data'
                : 'Recorded data'}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2.5">
          {memberships.length > 1 ? (
            <label className="flex items-center gap-2">
              <span className="sr-only">Active college</span>
              <select
                value={activeId}
                disabled={switching}
                onChange={(e) => void handleCollege(e.target.value)}
                className="max-w-44 rounded-md border border-violet/40 bg-obsidian px-2.5 py-1.5 text-xs font-medium text-ivory focus-ring disabled:opacity-50"
              >
                {memberships.map((membership) => (
                  <option key={membership.collegeId} value={membership.collegeId}>
                    {membership.collegeName} — {ROLE_LABELS[membership.role]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="hidden max-w-72 truncate text-xs text-ivory/60 sm:block">
              {workspace?.activeCollege.name}
            </span>
          )}

          {session ? (
            <details key={pathname} className="relative hidden sm:block">
              <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-md border border-violet/40 px-3 py-1.5 text-xs font-semibold text-ivory/80 hover:bg-violet/15 focus-ring [&::-webkit-details-marker]:hidden">
                <span className="max-w-52 truncate text-sm text-ivory/80">{session.user.displayName}</span>
                {role && (
                  <span className="rounded-md border border-violet/40 px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider text-violet-bright">
                    {ROLE_LABELS[role]}
                  </span>
                )}
                <span aria-hidden="true" className="text-[0.625rem] text-gold">▾</span>
              </summary>
              <nav
                aria-label="Profile menu"
                className="absolute right-0 z-40 mt-2 w-60 border border-violet/40 bg-obsidian p-1 shadow-lg"
              >
                <div className="border-b border-violet/20 px-3 py-2.5">
                  <p className="truncate text-sm text-ivory">{session.user.displayName}</p>
                  <p className="mt-0.5 break-words font-mono text-[0.625rem] text-ivory/45">
                    {session.user.username} · {workspace?.activeCollege.name ?? 'No college'}
                  </p>
                </div>
                <NavLink
                  to="/dashboard/help"
                  className={({ isActive }) =>
                    `block px-3 py-2.5 text-sm focus-ring ${
                      isActive ? 'bg-violet/15 text-ivory' : 'text-ivory/75 hover:bg-violet/10 hover:text-ivory'
                    }`
                  }
                >
                  Profile and Help
                </NavLink>
                {isAdmin && (
                  <>
                    <NavLink
                      to="/dashboard/data-centre"
                      className={({ isActive }) =>
                        `block px-3 py-2.5 text-sm focus-ring ${
                          isActive ? 'bg-violet/15 text-ivory' : 'text-ivory/75 hover:bg-violet/10 hover:text-ivory'
                        }`
                      }
                    >
                      Data Centre
                    </NavLink>
                    <NavLink
                      to="/dashboard/administration"
                      className={({ isActive }) =>
                        `block px-3 py-2.5 text-sm focus-ring ${
                          isActive ? 'bg-violet/15 text-ivory' : 'text-ivory/75 hover:bg-violet/10 hover:text-ivory'
                        }`
                      }
                    >
                      Administration
                    </NavLink>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  disabled={signingOut}
                  className="block w-full px-3 py-2.5 text-left text-sm text-ivory/75 hover:bg-violet/10 hover:text-ivory focus-ring disabled:opacity-50"
                >
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
              </nav>
            </details>
          ) : (
            <Link
              to="/signin"
              className="rounded-md border border-violet/40 px-3 py-1.5 text-xs font-semibold text-ivory/80 hover:bg-violet/15 focus-ring"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
