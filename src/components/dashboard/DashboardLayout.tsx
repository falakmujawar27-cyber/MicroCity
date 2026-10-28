import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import PersonalShell from './PersonalShell'
import { useAuth } from '../../auth/auth-context'

function WorkspaceGate() {
  const { error, refresh, signOut, loadingWorkspace } = useAuth()
  const navigate = useNavigate()
  const [retrying, setRetrying] = useState(false)

  return (
    <div className="mx-auto max-w-xl border border-violet/40 bg-obsidian px-6 py-10">
      <p className="font-mono text-xs uppercase tracking-widest text-gold">Workspace unavailable</p>
      <h2 className="mt-3 font-heading text-2xl text-ivory">The workspace could not be loaded</h2>
      <p className="mt-3 text-sm leading-relaxed text-ivory/70">
        {error ?? 'No college membership is attached to this account.'}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={retrying || loadingWorkspace}
          onClick={async () => {
            setRetrying(true)
            await refresh()
            setRetrying(false)
          }}
          className="rounded-md bg-violet px-4 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:opacity-50"
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
        <button
          type="button"
          onClick={async () => {
            navigate('/', { replace: true })
            await signOut()
          }}
          className="rounded-md border border-violet/40 px-4 py-2 text-sm text-ivory/80 hover:bg-violet/15 focus-ring"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

function WorkspaceLoading() {
  return (
    <div className="border border-violet/30 bg-obsidian px-6 py-10">
      <p className="font-mono text-xs uppercase tracking-widest text-violet-bright">Loading workspace…</p>
      <p className="mt-3 text-sm text-ivory/60">Reading the college records and working out the figures.</p>
    </div>
  )
}

export default function DashboardLayout() {
  const [drawerPath, setDrawerPath] = useState<string | null>(null)
  const { pathname } = useLocation()
  const { workspace, loadingWorkspace, error, role } = useAuth()
  // The drawer is only open on the route where it was opened, so navigation
  // closes it without an effect that would trigger a second render.
  const drawerOpen = drawerPath === pathname

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerPath(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const showGate = !workspace && Boolean(error)
  const showLoading = !workspace && !error && loadingWorkspace
  const showInitialLoading = !workspace && !error && !loadingWorkspace

  // Students, faculty and the maintenance technician all work on a phone, so
  // they share the mobile shell with its bottom navigation.
  if (role === 'student' || role === 'faculty' || role === 'maintenance') return <PersonalShell />

  return (
    <div className="theme-workspace min-h-screen bg-ink">
      <Sidebar className="fixed inset-y-0 left-0 z-40 hidden w-72 lg:flex" />

      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/70 lg:hidden"
            aria-hidden="true"
            onClick={() => setDrawerPath(null)}
          />
          <Sidebar
            variant="drawer"
            onClose={() => setDrawerPath(null)}
            className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col lg:hidden"
          />
        </>
      )}

      <div className="relative flex min-h-screen flex-col lg:pl-72">
        <TopBar onMenuClick={() => setDrawerPath(pathname)} />
        <main className="relative mx-auto w-full max-w-7xl flex-1 px-6 py-10 md:px-10 md:py-14">
          {showGate ? (
            <WorkspaceGate />
          ) : showLoading || showInitialLoading ? (
            <WorkspaceLoading />
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  )
}
