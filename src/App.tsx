import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './auth/auth-context'
import Home from './pages/Home'
import NotFound from './pages/NotFound'
import SignIn from './pages/SignIn'
import DashboardLayout from './components/dashboard/DashboardLayout'
import Overview from './pages/dashboard/Overview'
import Inventory from './pages/dashboard/Inventory'
import Resources from './pages/dashboard/Resources'
import NeedsGaps from './pages/dashboard/NeedsGaps'
import IssuesMaintenance from './pages/dashboard/IssuesMaintenance'
import PlanReport from './pages/dashboard/PlanReport'
import DataCentre from './pages/dashboard/DataCentre'
import Support from './pages/dashboard/Support'
import Administration from './pages/dashboard/Administration'
import StudentHome from './pages/dashboard/StudentHome'
import ReportProblem from './pages/dashboard/ReportProblem'
import MyReports from './pages/dashboard/MyReports'
import PublicReport from './pages/dashboard/PublicReport'
import Attendance from './pages/dashboard/Attendance'
import MaintenanceJobs from './pages/dashboard/MaintenanceJobs'
import MaintenanceInspections from './pages/dashboard/MaintenanceInspections'
import PageHeading from './components/dashboard/PageHeading'
import Notice from './components/ui/Notice'
import { ROLE_LABELS } from './domain/types'
import type { UserRole } from './domain/types'

function CheckingSession() {
  return (
    <div className="theme-workspace grid min-h-screen place-items-center bg-ink px-6">
      <p className="font-mono text-xs uppercase tracking-widest text-violet-bright">
        Checking your MicroCity session…
      </p>
    </div>
  )
}

/** Route guard: the workspace requires a signed-in, server-verified session. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { session, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <CheckingSession />
  if (!session) return <Navigate to="/signin" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

function Forbidden({ allowed }: { allowed: UserRole[] }) {
  const { role } = useAuth()
  return (
    <>
      <PageHeading
        kicker="Access control"
        title="Not available for your role"
        description="This page is restricted. The server enforces the same rule, so the data is not loaded for your membership."
      />
      <Notice tone="warning" title="Role required">
        You are signed in as {role ? ROLE_LABELS[role] : 'an unrecognised role'}. This area is available to:{' '}
        {allowed.map((item) => ROLE_LABELS[item]).join(', ')}.
      </Notice>
      <Link
        to="/dashboard"
        className="mt-6 inline-flex rounded-md bg-violet px-4 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring"
      >
        Back to overview
      </Link>
    </>
  )
}

function RequireRole({ allowed, children }: { allowed: UserRole[]; children: ReactNode }) {
  const { role } = useAuth()
  if (!role || !allowed.includes(role)) return <Forbidden allowed={allowed} />
  return <>{children}</>
}

/** Students and faculty land on their personal home; technicians land on their jobs. */
function HomeRoute() {
  const { role } = useAuth()
  if (role === 'maintenance') return <MaintenanceJobs />
  if (role === 'student' || role === 'faculty') return <StudentHome />
  return <Overview />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public landing page */}
          <Route path="/" element={<Home />} />

          {/* Server-backed sign-in and registration */}
          <Route path="/signin" element={<SignIn />} />

          {/* Authenticated dashboard shell; page-level role guards below.
              Record-level rules and cross-college checks are enforced again
              by the API on every request. */}
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <DashboardLayout />
              </RequireAuth>
            }
          >
            <Route index element={<HomeRoute />} />

            <Route
              path="report"
              element={
                <RequireRole allowed={['student', 'faculty']}>
                  <ReportProblem />
                </RequireRole>
              }
            />
            <Route
              path="my-reports"
              element={
                <RequireRole allowed={['student', 'faculty']}>
                  <MyReports />
                </RequireRole>
              }
            />
            <Route
              path="report-public"
              element={
                <RequireRole allowed={['student', 'faculty']}>
                  <PublicReport />
                </RequireRole>
              }
            />
            <Route
              path="attendance"
              element={
                <RequireRole allowed={['admin', 'faculty']}>
                  <Attendance />
                </RequireRole>
              }
            />

            <Route
              path="inventory"
              element={
                <RequireRole allowed={['admin', 'estates']}>
                  <Inventory />
                </RequireRole>
              }
            />
            <Route
              path="needs-gaps"
              element={
                <RequireRole allowed={['admin', 'estates']}>
                  <NeedsGaps />
                </RequireRole>
              }
            />
            <Route
              path="resources"
              element={
                <RequireRole allowed={['admin', 'estates']}>
                  <Resources />
                </RequireRole>
              }
            />
            <Route
              path="issues-maintenance"
              element={
                <RequireRole allowed={['admin', 'estates']}>
                  <IssuesMaintenance />
                </RequireRole>
              }
            />
            <Route
              path="inspections"
              element={
                <RequireRole allowed={['maintenance']}>
                  <MaintenanceInspections />
                </RequireRole>
              }
            />
            <Route
              path="plan-report"
              element={
                <RequireRole allowed={['admin', 'estates']}>
                  <PlanReport />
                </RequireRole>
              }
            />
            <Route
              path="data-centre"
              element={
                <RequireRole allowed={['admin', 'estates']}>
                  <DataCentre />
                </RequireRole>
              }
            />
            <Route path="help" element={<Support />} />
            <Route path="support" element={<Navigate to="/dashboard/help" replace />} />
            <Route
              path="administration"
              element={
                <RequireRole allowed={['admin']}>
                  <Administration />
                </RequireRole>
              }
            />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
