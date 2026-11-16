import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/auth-context'
import { api, ApiError } from '../lib/api'
import { formatNumber } from '../lib/format'

type CollegeRow = Awaited<ReturnType<typeof api.platformColleges>>['colleges'][number]

interface CreatedCollege {
  name: string
  code: string
  username: string
  temporaryPassword: string
  notice: string
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <p className="font-mono text-[0.625rem] uppercase tracking-widest text-ivory/45">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <code className="min-w-0 break-all border border-violet/30 bg-ink px-2.5 py-1.5 text-sm text-ivory">{value}</code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value)
              setCopied(true)
            } catch {
              setCopied(false)
            }
          }}
          className="rounded-md border border-violet/40 px-3 py-2 text-xs font-semibold text-ivory/80 hover:bg-violet/15 focus-ring"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

export default function Platform() {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()
  const [colleges, setColleges] = useState<CollegeRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [email, setEmail] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<CreatedCollege | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await api.platformColleges()
      setColleges(result.colleges)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'The college list could not be loaded.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setFieldErrors({})
    setFormError(null)
    setCreated(null)
    try {
      const result = await api.createCollege({ name: name.trim(), address: address.trim(), email: email.trim() })
      setCreated({
        name: result.college.name,
        code: result.college.code,
        username: result.admin.username,
        temporaryPassword: result.admin.temporaryPassword,
        notice: result.notice,
      })
      setName('')
      setAddress('')
      setEmail('')
      await load()
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors)
        setFormError(err.message)
      } else {
        setFormError('The college could not be created. Try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="theme-workspace min-h-screen bg-ink px-5 py-10 text-ivory sm:px-8 md:py-14">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-violet/30 pb-6">
          <div>
            <p className="font-mono text-[0.625rem] uppercase tracking-[0.25em] text-violet-bright">
              MicroCity · Platform administration
            </p>
            <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-ivory">
              Colleges on this installation
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ivory/65">
              Creating a college also creates its first administrator. The college code is what students and
              faculty use to sign up; the administrator creates the Estates and Maintenance accounts.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ivory/55">{session?.user.displayName}</span>
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
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section className="border border-violet/30 bg-obsidian p-5">
            <h2 className="font-heading text-xl font-semibold text-ivory">Create a college</h2>
            <p className="mt-1 text-sm text-ivory/60">
              The public “Register your college” flow is designed but not implemented; this page is the only
              way to add a college.
            </p>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <div>
                <label htmlFor="college-name" className="block text-sm font-medium text-ivory/85">
                  College name
                </label>
                <input
                  id="college-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={160}
                  className="mt-1.5 w-full rounded-md border border-violet/40 bg-ink px-3 py-2.5 text-sm text-ivory placeholder:text-ivory/35 focus-ring"
                />
                {fieldErrors['College name'] && <p className="mt-1 text-xs text-status-error-dark">{fieldErrors['College name']}</p>}
              </div>
              <div>
                <label htmlFor="college-address" className="block text-sm font-medium text-ivory/85">
                  Address
                </label>
                <input
                  id="college-address"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  required
                  maxLength={240}
                  className="mt-1.5 w-full rounded-md border border-violet/40 bg-ink px-3 py-2.5 text-sm text-ivory placeholder:text-ivory/35 focus-ring"
                />
                {fieldErrors.Address && <p className="mt-1 text-xs text-status-error-dark">{fieldErrors.Address}</p>}
              </div>
              <div>
                <label htmlFor="college-email" className="block text-sm font-medium text-ivory/85">
                  Official email
                </label>
                <input
                  id="college-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  maxLength={160}
                  className="mt-1.5 w-full rounded-md border border-violet/40 bg-ink px-3 py-2.5 text-sm text-ivory placeholder:text-ivory/35 focus-ring"
                />
                {fieldErrors['Official email'] && <p className="mt-1 text-xs text-status-error-dark">{fieldErrors['Official email']}</p>}
              </div>
              {formError && (
                <p role="alert" className="border border-status-error-dark/60 bg-status-error-dark/10 px-3 py-2 text-sm text-status-error-dark">
                  {formError}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="min-h-11 rounded-md bg-violet px-4 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:opacity-50"
              >
                {busy ? 'Creating…' : 'Create college and administrator'}
              </button>
            </form>

            {created && (
              <div className="mt-5 border border-gold/50 bg-gold/5 p-4">
                <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">
                  Shown once — record it before leaving
                </p>
                <h3 className="mt-2 font-heading text-lg font-semibold text-ivory">{created.name} created</h3>
                <div className="mt-3 space-y-3">
                  <CopyField label="College code (for student and faculty sign-up)" value={created.code} />
                  <CopyField label="Administrator username" value={created.username} />
                  <CopyField label="Temporary password (never shown again)" value={created.temporaryPassword} />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-ivory/60">{created.notice}</p>
                <p className="mt-1 text-xs leading-relaxed text-ivory/60">
                  Temporary passwords are not forced to change on first sign-in.
                </p>
              </div>
            )}

            {loadError && <p className="mt-4 text-sm text-status-error-dark">{loadError}</p>}
          </section>

          <section className="border border-violet/30 bg-obsidian p-5">
            <h2 className="font-heading text-xl font-semibold text-ivory">
              Colleges {colleges ? `(${formatNumber(colleges.length)})` : ''}
            </h2>
            {!colleges && !loadError && <p className="mt-3 text-sm text-ivory/60">Loading colleges…</p>}
            {colleges && colleges.length === 0 && (
              <p className="mt-3 text-sm text-ivory/60">No college exists on this installation yet.</p>
            )}
            {colleges && colleges.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[32rem] text-left text-sm">
                  <thead className="border-b border-violet/30 font-mono text-[0.625rem] uppercase tracking-widest text-violet-bright">
                    <tr>
                      <th scope="col" className="px-2 py-2 font-medium">College</th>
                      <th scope="col" className="px-2 py-2 font-medium">Code</th>
                      <th scope="col" className="px-2 py-2 font-medium">Mode</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">Members</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-violet/20">
                    {colleges.map((college) => (
                      <tr key={college.id} className="align-top">
                        <td className="px-2 py-3">
                          <p className="font-semibold text-ivory">{college.name}</p>
                          <p className="mt-0.5 text-xs text-ivory/50">{college.address ?? 'No address recorded'}</p>
                          <p className="mt-0.5 break-all text-xs text-ivory/50">{college.email ?? 'No email recorded'}</p>
                        </td>
                        <td className="px-2 py-3 font-mono text-xs text-ivory/75">{college.code ?? 'Not set'}</td>
                        <td className="px-2 py-3 text-xs text-ivory/75">{college.mode === 'pilot' ? 'Pilot' : 'Demo'}</td>
                        <td className="px-2 py-3 text-right font-mono text-xs text-ivory/75">{formatNumber(college.members)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-4 border-t border-violet/20 pt-3 text-xs leading-relaxed text-ivory/50">
              College codes are shared without approval or email verification. A college code is not a secret
              that proves anyone belongs to the college.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
