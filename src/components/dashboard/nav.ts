import type { UserRole } from '../../domain/types'

export interface DashboardNavItem {
  label: string
  path: string
  /** One-line role-aware description used in the sidebar footer. */
  hint: string
}

const ALL: DashboardNavItem[] = [
  { label: 'Overview', path: '/dashboard', hint: 'Priority findings and module status' },
  { label: 'Inventory', path: '/dashboard/inventory', hint: 'Buildings, rooms, assets, inspections' },
  { label: 'Needs & Gaps', path: '/dashboard/needs-gaps', hint: 'Capacity, utilisation and needs scores' },
  { label: 'Resources', path: '/dashboard/resources', hint: 'Electricity, water and tariffs' },
  { label: 'Issues & Maintenance', path: '/dashboard/issues-maintenance', hint: 'Complaints, public issues, inspections' },
  { label: 'Plan & Report', path: '/dashboard/plan-report', hint: 'Options, decisions and exports' },
  { label: 'Data Centre', path: '/dashboard/data-centre', hint: 'Import and audit history' },
  { label: 'Help', path: '/dashboard/help', hint: 'Using the workspace and your role' },
  { label: 'Administration', path: '/dashboard/administration', hint: 'Roles, accounts and AI status' },
]

const PERSONAL: DashboardNavItem[] = [
  { label: 'Home', path: '/dashboard', hint: 'Your reports and nearby public issues' },
  { label: 'Report', path: '/dashboard/report', hint: 'Tell the college what is broken' },
  { label: 'Attendance', path: '/dashboard/attendance', hint: 'Record who came to a timetabled class' },
  { label: 'My reports', path: '/dashboard/my-reports', hint: 'Follow the reports you have raised' },
]

const MAINTENANCE: DashboardNavItem[] = [
  { label: 'My jobs', path: '/dashboard', hint: 'Jobs assigned to you, in order' },
  { label: 'Inspections', path: '/dashboard/inspections', hint: 'Inspections due and recorded' },
  { label: 'Help', path: '/dashboard/help', hint: 'Using the workspace and your role' },
]

const HELP = '/dashboard/help'
const ADMINISTRATION = '/dashboard/administration'
const byPath = (...paths: string[]) => ALL.filter((item) => paths.includes(item.path))

/**
 * Primary navigation. No sidebar or bottom navigation renders more than five
 * items. Staff keep the five operational modules here; planning, data and
 * help links live in the top bar's secondary menu.
 */
export function dashboardNavFor(role: UserRole | null): DashboardNavItem[] {
  if (!role) return byPath('/dashboard', HELP)
  if (role === 'student') return PERSONAL.filter((item) => item.path !== '/dashboard/attendance')
  if (role === 'faculty') return PERSONAL
  if (role === 'maintenance') {
    // Three items only: the technician works through jobs and inspections.
    return MAINTENANCE
  }
  return byPath(
    '/dashboard',
    '/dashboard/inventory',
    '/dashboard/needs-gaps',
    '/dashboard/resources',
    '/dashboard/issues-maintenance',
  )
}

/** Secondary staff links shown in the top bar, outside the sidebar. */
export function dashboardMoreNavFor(role: UserRole | null): DashboardNavItem[] {
  if (role === 'admin') {
    return byPath('/dashboard/plan-report', '/dashboard/data-centre', ADMINISTRATION, HELP)
  }
  if (role === 'estates') {
    return byPath('/dashboard/plan-report', '/dashboard/data-centre', HELP)
  }
  return []
}

export function navLabelFor(items: DashboardNavItem[], pathname: string): string {
  const exact = items.find((item) => item.path === pathname)
  if (exact) return exact.label
  const nested = [...items]
    .filter((item) => item.path !== '/dashboard' && pathname.startsWith(item.path))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (nested) return nested.label
  if (pathname.startsWith('/dashboard/report')) return 'Report a problem'
  if (pathname.startsWith('/dashboard/my-reports')) return 'My reports'
  if (pathname.startsWith('/dashboard/attendance')) return 'Log attendance'
  return 'Workspace'
}
