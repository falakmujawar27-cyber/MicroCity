import assert from 'node:assert/strict'
import test from 'node:test'
import { dashboardMoreNavFor, dashboardNavFor } from '../src/components/dashboard/nav.ts'
import type { UserRole } from '../src/domain/types.ts'

const paths = (role: UserRole) => dashboardNavFor(role).map((item) => item.path)
const labels = (role: UserRole) => dashboardNavFor(role).map((item) => item.label)
const morePaths = (role: UserRole) => dashboardMoreNavFor(role).map((item) => item.path)

const ROLES: UserRole[] = ['admin', 'estates', 'maintenance', 'faculty', 'student']

test('no primary navigation lists more than five items', () => {
  for (const role of ROLES) {
    assert.ok(dashboardNavFor(role).length <= 5, `${role} should not have more than five primary items`)
  }
})

test('students get exactly Home, Report and My reports', () => {
  assert.deepEqual(paths('student'), ['/dashboard', '/dashboard/report', '/dashboard/my-reports'])
  assert.deepEqual(labels('student'), ['Home', 'Report', 'My reports'])
})

test('faculty add Attendance as the fourth short nav label', () => {
  assert.deepEqual(paths('faculty'), [
    '/dashboard',
    '/dashboard/report',
    '/dashboard/attendance',
    '/dashboard/my-reports',
  ])
  assert.deepEqual(labels('faculty'), ['Home', 'Report', 'Attendance', 'My reports'])
})

test('administration remains administrator-only and moves to the secondary menu', () => {
  assert.ok(morePaths('admin').includes('/dashboard/administration'))
  for (const role of ROLES.filter((item) => item !== 'admin')) {
    assert.ok(!paths(role).includes('/dashboard/administration'), `${role} should not see Administration`)
    assert.ok(!morePaths(role).includes('/dashboard/administration'), `${role} should not see Administration`)
  }
})

test('staff can still reach Help within the five-item limit', () => {
  assert.ok(paths('maintenance').includes('/dashboard/help'))
  assert.ok(morePaths('admin').includes('/dashboard/help'))
  assert.ok(morePaths('estates').includes('/dashboard/help'))
})
