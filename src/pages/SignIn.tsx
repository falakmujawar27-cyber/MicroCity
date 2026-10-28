import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { api } from '../lib/api'
import type { College, UserRole } from '../domain/types'
import { ROLE_LABELS } from '../domain/types'
import Notice from '../components/ui/Notice'

type Step = 'role' | 'credentials' | 'register'

interface DemoAccount {
  role: UserRole
  username: string
  password: string
  collegeId: string
  collegeName: string
}

const ROLE_TILES: { role: UserRole; name: string; line: string }[] = [
  { role: 'student', name: 'Student', line: 'Report a problem in your classroom, lab or hostel.' },
  { role: 'faculty', name: 'Faculty', line: 'Report issues and follow the repairs that affect your classes.' },
  { role: 'maintenance', name: 'Maintenance', line: 'See your assigned jobs and update them as you work.' },
  { role: 'estates', name: 'Estates', line: 'Keep the campus records, meters and readings in order.' },
  { role: 'admin', name: 'Admin', line: 'Manage people, roles and the decisions for your college.' },
]

const DEMO_LABELS: Record<UserRole, string> = {
  student: 'Student',
  faculty: 'Faculty',
  maintenance: 'Maintenance',
  estates: 'Estates',
  admin: 'Admin',
}

function roleName(role: UserRole | null): string {
  return role ? DEMO_LABELS[role] : 'your role'
}

function isRole(value: string | null): value is UserRole {
  return value === 'student' || value === 'faculty' || value === 'maintenance' || value === 'estates' || value === 'admin'
}

export default function SignIn() {
  const { session, ready, signIn, register, signOut, workspace } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard'

  const requestedRole = new URLSearchParams(location.search).get('role')
  const initialRole = isRole(requestedRole) ? requestedRole : null

  const [step, setStep] = useState<Step>(initialRole ? 'credentials' : 'role')
  const [role, setRole] = useState<UserRole | null>(initialRole)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [collegeCode, setCollegeCode] = useState('')
  const [registerRole, setRegisterRole] = useState<'student' | 'faculty'>('student')
  const [collegeId, setCollegeId] = useState('')
  const [colleges, setColleges] = useState<College[]>([])
  const [collegesError, setCollegesError] = useState<string | null>(null)
  const [demo, setDemo] = useState<{ enabled: boolean; accounts: DemoAccount[] }>({ enabled: false, accounts: [] })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api
      .colleges()
      .then((result) => {
        if (cancelled) return
        setColleges(result.colleges)
        setCollegeId((current) => current || result.colleges[0]?.id || '')
      })
      .catch(() => {
        if (!cancelled) setCollegesError('The college list could not be loaded. Check that the server is running.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void api
      .demoAccounts()
      .then((result) => {
        if (!cancelled) setDemo({ enabled: result.enabled, accounts: result.accounts })
      })
      .catch(() => {
        /* Demo mode is optional; the normal sign-in form still works. */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const chooseRole = (next: UserRole) => {
    setRole(next)
    setError(null)
    setStep('credentials')
  }

  const fillDemo = (account: DemoAccount) => {
    setRole(account.role)
    setUsername(account.username)
    setPassword(account.password)
    setCollegeId(account.collegeId)
    setError(null)
    setStep('credentials')
  }

  const submitSignIn = async (event: FormEvent) => {
    event.preventDefault()
    if (!role) {
      setStep('role')
      return
    }
    setBusy(true)
    setError(null)
    const result = await signIn(username.trim(), password, collegeId || undefined, role)
    setBusy(false)
    if (result.ok) navigate(from, { replace: true })
    else setError(result.error ?? 'The request failed.')
  }

  const submitRegister = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const result = await register({
      username: username.trim(),
      displayName: displayName.trim(),
      password,
      collegeCode: collegeCode.trim(),
      role: registerRole,
    })
    setBusy(false)
    if (result.ok) navigate(from, { replace: true })
    else setError(result.error ?? 'The request failed.')
  }

  const startRegister = () => {
    setError(null)
    setUsername('')
    setPassword('')
    setDisplayName('')
    setCollegeCode('')
    setStep('register')
  }

  const message = error && <div className="mb-5"><Notice tone="danger">{error}</Notice></div>

  return (
    <div className="theme-workspace min-h-screen bg-ink px-5 py-10 text-ivory sm:px-8 md:py-14">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <Link to="/" className="flex min-h-11 items-center gap-2 font-heading text-2xl font-semibold tracking-tight text-ivory focus-ring">
            <span className="h-2 w-2 bg-gold" aria-hidden="true" />
            MicroCity
          </Link>
          <Link to="/" className="inline-flex min-h-11 items-center text-sm text-ivory/70 underline decoration-violet/50 underline-offset-4 hover:text-ivory focus-ring">
            Back to home
          </Link>
        </div>

        <div className="border-t border-violet/40 pt-5">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold">
            {step === 'role' ? 'Step 1 of 2' : step === 'credentials' ? 'Step 2 of 2' : 'New account'}
          </p>
          <h1 className="mt-3 font-heading text-3xl font-bold tracking-tight md:text-4xl">
            {session
              ? 'You are signed in'
              : step === 'role'
                ? 'Who are you signing in as?'
                : step === 'credentials'
                  ? `Sign in as ${roleName(role)}`
                  : 'Create a student or faculty account'}
          </h1>
        </div>

        {!ready ? (
          <p className="mt-10 font-mono text-xs uppercase tracking-[0.2em] text-violet-bright">Checking session…</p>
        ) : session ? (
          <div className="mt-8 max-w-2xl border border-violet/40 bg-obsidian p-6 md:p-8">
            <p className="text-sm text-ivory/70">
              Signed in as <span className="font-semibold text-ivory">{session.user.displayName}</span>
              {workspace && (
                <>
                  {' '}at <span className="text-ivory">{workspace.activeCollege.name}</span> as{' '}
                  <span className="text-violet-bright">{ROLE_LABELS[workspace.activeCollege.role]}</span>
                </>
              )}
              .
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-violet px-5 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring"
              >
                Open workspace
              </button>
              <button
                type="button"
                onClick={async () => {
                  navigate('/', { replace: true })
                  await signOut()
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-violet/40 px-5 text-sm font-semibold text-ivory/80 hover:bg-violet/10 focus-ring"
              >
                Sign out
              </button>
            </div>
          </div>
        ) : step === 'role' ? (
          <div className="mt-8">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              {ROLE_TILES.map((tile) => (
                <button
                  key={tile.role}
                  type="button"
                  onClick={() => chooseRole(tile.role)}
                  className="group flex min-h-32 flex-col border border-violet/30 bg-obsidian p-5 text-left transition-colors hover:border-violet/70 hover:bg-violet/5 focus-ring"
                >
                  <span className="font-heading text-xl font-semibold">{tile.name}</span>
                  <span className="mt-2 text-sm leading-relaxed text-ivory/70">{tile.line}</span>
                  <span className="mt-4 font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-violet-bright">
                    Choose {tile.name}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-6 text-sm leading-relaxed text-ivory/70">
              Not sure? Choose the role that matches your account. The server checks it before signing you in.
            </p>
            <button
              type="button"
              onClick={startRegister}
              className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-violet-bright underline decoration-violet/40 underline-offset-4 focus-ring"
            >
              Create a student or faculty account
            </button>
          </div>
        ) : step === 'credentials' ? (
          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <div>
              <form onSubmit={submitSignIn} className="border border-violet/30 bg-obsidian p-6 md:p-8">
                {message}
                <div className="mb-5 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded border border-violet/40 bg-violet/10 px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-violet-bright">
                    {ROLE_LABELS[role ?? 'student']}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      setStep('role')
                    }}
                    className="inline-flex min-h-11 items-center px-1 text-sm text-ivory/70 underline decoration-violet/40 underline-offset-4 hover:text-ivory focus-ring"
                  >
                    Choose a different role
                  </button>
                </div>

                <label htmlFor="college" className="mb-1 block font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ivory/70">
                  College
                </label>
                <select
                  id="college"
                  value={collegeId}
                  onChange={(event) => setCollegeId(event.target.value)}
                  required
                  className="mb-4 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                >
                  {colleges.length === 0 && <option value="">Loading colleges…</option>}
                  {colleges.map((college) => (
                    <option key={college.id} value={college.id}>
                      {college.name}
                    </option>
                  ))}
                </select>
                {collegesError && <p className="mb-3 text-sm text-status-error-dark">{collegesError}</p>}

                <label htmlFor="username" className="mb-1 block font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ivory/70">
                  Username
                </label>
                <input
                  id="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  required
                  className="mb-4 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                />

                <label htmlFor="password" className="mb-1 block font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ivory/70">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                  className="mb-6 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
                />

                <button
                  type="submit"
                  disabled={busy || !collegeId}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-violet px-4 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:opacity-50"
                >
                  {busy ? 'Signing in…' : `Sign in as ${roleName(role)}`}
                </button>

                <button
                  type="button"
                  onClick={startRegister}
                  className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-violet-bright underline decoration-violet/40 underline-offset-4 focus-ring"
                >
                  Create a student or faculty account
                </button>
              </form>

              {demo.enabled && demo.accounts.length > 0 && (
                <div className="mt-6 border border-gold/60 bg-gold/5 p-5">
                  <p className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-gold">Demo mode</p>
                  <p className="mt-2 text-sm leading-relaxed text-ivory/70">
                    Choose a role to fill in the demonstration credentials. Nothing is submitted until you press Sign in.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {demo.accounts.map((account) => (
                      <button
                        key={account.role}
                        type="button"
                        onClick={() => fillDemo(account)}
                        className="inline-flex min-h-11 items-center justify-center rounded-md border border-gold/60 bg-obsidian px-3 text-sm font-semibold text-ivory hover:bg-gold/10 focus-ring"
                      >
                        Try as {DEMO_LABELS[account.role]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <aside className="border border-violet/30 bg-obsidian p-6 md:p-8">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-gold">Before you sign in</p>
              <ul className="mt-4 space-y-3 text-sm leading-relaxed text-ivory/70">
                <li>Each college's records are kept separate.</li>
                <li>Your role decides which pages and actions you can use.</li>
                <li>Maintenance, estates and admin accounts are created by your college admin.</li>
                <li>Passwords are stored as hashed values on the server.</li>
              </ul>
            </aside>
          </div>
        ) : (
          <div className="mt-8 max-w-2xl">
            <form onSubmit={submitRegister} className="border border-violet/30 bg-obsidian p-6 md:p-8">
              {message}
              <label htmlFor="displayName" className="mb-1 block font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ivory/70">
                Full name
              </label>
              <input
                id="displayName"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                required
                className="mb-4 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
              />

              <label htmlFor="register-username" className="mb-1 block font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ivory/70">
                Username
              </label>
              <input
                id="register-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                required
                className="mb-4 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
              />

              <label htmlFor="register-password" className="mb-1 block font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ivory/70">
                Password
              </label>
              <input
                id="register-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
                minLength={10}
                className="mb-4 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
              />
              <p className="mb-4 text-xs leading-relaxed text-ivory/60">At least 10 characters.</p>

              <label htmlFor="college-code" className="mb-1 block font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ivory/70">
                College code
              </label>
              <input
                id="college-code"
                value={collegeCode}
                onChange={(event) => setCollegeCode(event.target.value)}
                autoComplete="off"
                required
                className="mb-1 min-h-11 w-full rounded-md border border-violet/40 bg-ink px-3 text-base text-ivory focus-ring"
              />
              <p className="mb-4 text-xs leading-relaxed text-ivory/60">
                Your college gives you this code. It is not shown in the college list.
              </p>

              <fieldset className="mb-6">
                <legend className="mb-2 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ivory/70">
                  Role
                </legend>
                <div className="flex flex-wrap gap-4 text-sm text-ivory/85">
                  {(['student', 'faculty'] as const).map((value) => (
                    <label key={value} className="flex min-h-11 items-center gap-2">
                      <input
                        type="radio"
                        name="register-role"
                        value={value}
                        checked={registerRole === value}
                        onChange={() => setRegisterRole(value)}
                        className="accent-[#4235a8]"
                      />
                      {ROLE_LABELS[value]}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ivory/60">
                  Only student and faculty accounts can be created here. Maintenance, estates and admin accounts are
                  created by the college admin.
                </p>
              </fieldset>

              <button
                type="submit"
                disabled={busy}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-violet px-4 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:opacity-50"
              >
                {busy ? 'Creating account…' : 'Create account'}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                setError(null)
                setStep('role')
              }}
              className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-violet-bright underline decoration-violet/40 underline-offset-4 focus-ring"
            >
              Back to sign in
            </button>
          </div>
        )}

        <p className="mt-10 text-xs leading-relaxed text-ivory/60">
          MicroCity demonstration workspace. Sign-in attempts are rate-limited by the server.
        </p>
      </div>
    </div>
  )
}
