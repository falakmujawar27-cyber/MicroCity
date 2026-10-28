import { NavLink } from 'react-router-dom'
import { dashboardNavFor } from './nav'
import { useAuth } from '../../auth/auth-context'
import { ROLE_LABELS } from '../../domain/types'

interface SidebarProps {
  className?: string
  variant?: 'fixed' | 'drawer'
  onClose?: () => void
}

export default function Sidebar({ className = '', variant = 'fixed', onClose }: SidebarProps) {
  const { role, workspace, session } = useAuth()
  const items = dashboardNavFor(role)
  const college = workspace?.activeCollege

  return (
    <aside
      className={`flex-col overflow-y-auto bg-obsidian border-r border-violet/30 ${className}`}
      aria-label="Workspace navigation"
      {...(variant === 'drawer' ? { role: 'dialog', 'aria-modal': true } : {})}
    >
      {variant === 'drawer' && (
        <div className="flex items-center justify-between px-6 pt-5 lg:hidden">
          <span className="font-heading text-lg font-semibold tracking-tighter text-ivory">MicroCity</span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ivory hover:bg-violet/20 focus-ring"
            aria-label="Close navigation menu"
            autoFocus
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="px-6 pb-6 pt-8">
        <NavLink
          to="/"
          title="Back to landing page"
          className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tighter text-ivory focus-ring"
        >
          <span className="h-2 w-2 bg-gold" aria-hidden="true" />
          MicroCity
        </NavLink>
        <p className="mt-2 text-xs uppercase tracking-widest text-violet-bright/80">
          Infrastructure workspace
        </p>
        {college && (
          <p className="mt-4 border-l-2 border-gold/70 pl-3 text-sm leading-snug text-ivory/80">
            {college.name}
            <span className="mt-0.5 block font-mono text-[0.625rem] uppercase tracking-widest text-gold">
              {ROLE_LABELS[college.role]} workspace
            </span>
          </p>
        )}
        <div className="mt-5 border-t border-violet/30" aria-hidden="true" />
      </div>

      <nav className="flex-1 pb-6">
        <ul className="space-y-1 px-3">
          {items.map((item, i) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === '/dashboard'}
                title={item.hint}
                className={({ isActive }) =>
                  `group flex items-baseline gap-3 border-l-2 py-2.5 pl-4 pr-3 text-sm transition-colors focus-ring ${
                    isActive
                      ? 'border-violet bg-violet/15 text-ivory'
                      : 'border-transparent text-ivory/60 hover:bg-violet/10 hover:text-ivory'
                  }`
                }
              >
                <span
                  aria-hidden="true"
                  className="font-mono text-[0.6875rem] text-gold/70 transition-colors group-hover:text-gold"
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-violet/30 px-6 py-5">
        <p className="text-xs leading-relaxed text-ivory/50">
          Records belong to the selected college. Imported rows are labelled by source file in the Data Centre.
        </p>
        {session && (
          <p className="mt-3 truncate border-t border-violet/20 pt-3 font-mono text-[0.6875rem] text-ivory/40">
            {session.user.username}
          </p>
        )}
      </div>
    </aside>
  )
}
