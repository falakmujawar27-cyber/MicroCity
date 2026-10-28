import type { UserRole } from './types.ts'

/** Shared capability rules used by both the API and the interface. */
export type Capability =
  | 'manage-inventory'
  | 'import-data'
  | 'assign-complaints'
  | 'view-all-complaints'
  | 'view-assigned-only'
  | 'view-resources'
  | 'view-plan'
  | 'approve-decisions'
  | 'manage-users'
  | 'manage-urban-assets'
  | 'update-urban-issues'
  | 'view-audit'
  | 'submit-complaints'

const CAPABILITIES: Record<Capability, readonly UserRole[]> = {
  'manage-inventory': ['admin', 'estates'],
  'import-data': ['admin', 'estates'],
  'assign-complaints': ['admin', 'estates'],
  'view-all-complaints': ['admin', 'estates'],
  'view-assigned-only': ['maintenance'],
  'view-resources': ['admin', 'estates'],
  'view-plan': ['admin', 'estates'],
  'approve-decisions': ['admin'],
  'manage-users': ['admin'],
  'manage-urban-assets': ['admin'],
  'update-urban-issues': ['admin', 'estates'],
  'view-audit': ['admin', 'estates'],
  'submit-complaints': ['admin', 'estates', 'maintenance', 'faculty', 'student'],
}

export function hasCapability(role: UserRole, capability: Capability): boolean {
  return CAPABILITIES[capability].includes(role)
}

export function isStaffRole(role: UserRole): boolean {
  return role === 'admin' || role === 'estates' || role === 'maintenance'
}

export function canApproveDecision(role: UserRole): boolean {
  return role === 'admin'
}

export function canUpdateAssignedComplaint(role: UserRole, assignedToUserId: string | null, userId: string): boolean {
  if (role === 'admin' || role === 'estates') return true
  if (role === 'maintenance') return assignedToUserId === userId
  return false
}

export const ALL_ROLES: UserRole[] = ['admin', 'estates', 'maintenance', 'faculty', 'student']
