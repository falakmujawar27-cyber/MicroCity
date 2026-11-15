import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/auth-context'
import { api, ApiError } from '../../lib/api'
import Modal from '../../components/ui/Modal'
import InspectionForm from '../../components/dashboard/InspectionForm'
import JobCardView from '../../components/dashboard/JobCardView'
import type { InspectionCard, JobBoard, JobCard, JobGroup } from '../../domain/jobs'

const TABS: { key: JobGroup; label: string }[] = [
  { key: 'todo', label: 'To do' },
  { key: 'progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
]

const EMPTY: Record<JobGroup, { line: string; action: string; to?: string; tab?: JobGroup }> = {
  todo: { line: 'No job is waiting to be started.', action: 'Open inspections', to: '/dashboard/inspections' },
  progress: { line: 'Nothing is in progress right now.', action: 'See jobs to do', tab: 'todo' },
  done: { line: 'Nothing has been finished yet.', action: 'See jobs to do', tab: 'todo' },
}

export default function MaintenanceJobs() {
  const { workspace, role, refresh } = useAuth()
  const [board, setBoard] = useState<JobBoard | null>(null)
  const [tab, setTab] = useState<JobGroup>('todo')
  const [details, setDetails] = useState<JobCard | null>(null)
  const [completing, setCompleting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const collegeId = workspace?.activeCollege.id ?? null

  useEffect(() => {
    if (role !== 'maintenance' || !collegeId) return
    let cancelled = false
    void (async () => {
      try {
        const result = await api.jobBoard(collegeId)
        if (!cancelled) {
          setBoard(result)
          setMessage(null)
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(error instanceof ApiError ? error.message : 'The jobs could not be loaded.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [role, collegeId, nonce])

  const reload = async () => {
    setNonce((value) => value + 1)
    await refresh()
  }

  const start = async (job: JobCard) => {
    setBusy(true)
    setMessage(null)
    try {
      await api.startJob(job.id, collegeId)
      await reload()
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'The job could not be started.')
    } finally {
      setBusy(false)
    }
  }

  const finish = async (job: JobCard, note: string, photo: { name: string | null; dataUrl: string | null }) => {
    setBusy(true)
    setMessage(null)
    try {
      await api.completeJob(job.id, { note, photoName: photo.name, photoDataUrl: photo.dataUrl }, collegeId)
      setCompleting(null)
      await reload()
      noticeRef.current?.focus()
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'The job could not be marked done.')
    } finally {
      setBusy(false)
    }
  }

  if (!workspace || role !== 'maintenance') return null

  const jobs = board?.jobs.filter((job) => job.group === tab) ?? []
  const counts = board?.counts ?? { todo: 0, progress: 0, done: 0 }
  const dueInspection: InspectionCard | null =
    board?.inspections.find((inspection) => inspection.due === 'overdue' || inspection.due === 'due-soon') ?? null

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold leading-tight text-ivory">My jobs</h1>
        <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Maintenance</p>
      </div>

      <p ref={noticeRef} tabIndex={-1} className="sr-only" aria-live="polite">
        {message ?? ''}
      </p>
      {message && (
        <p className="mt-3 rounded-md border border-status-error-dark/50 bg-status-error-dark/10 px-3 py-2 text-sm text-ivory">
          {message}
        </p>
      )}

      <div className="mt-5 grid grid-cols-3 border-b border-violet/25" role="tablist" aria-label="Jobs by stage">
        {TABS.map((item) => {
          const active = item.key === tab
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.key)}
              className={`min-h-14 border-b-2 px-1 py-2 text-center text-sm leading-tight focus-ring ${
                active
                  ? 'border-violet font-semibold text-ivory'
                  : 'border-transparent text-ivory/60 hover:bg-violet/5 hover:text-ivory'
              }`}
            >
              {item.label} ({counts[item.key]})
            </button>
          )
        })}
      </div>

      <div className="mt-4 space-y-3">
        {jobs.map((job) => (
          <JobCardView
            key={job.id}
            job={job}
            busy={busy}
            completing={completing === job.id}
            onStart={() => void start(job)}
            onShowDetails={() => setDetails(job)}
            onComplete={completing === job.id ? (note, photo) => void finish(job, note, photo) : undefined}
            onCancelComplete={() => setCompleting(null)}
            onBeginComplete={() => {
              setCompleting(job.id)
              setMessage(null)
            }}
          />
        ))}

        {jobs.length === 0 && (
          <div className="border border-dashed border-violet/40 px-4 py-6 text-center">
            <p className="text-sm text-ivory/70">{EMPTY[tab].line}</p>
            {EMPTY[tab].to ? (
              <Link
                to={EMPTY[tab].to!}
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md border border-violet/50 px-4 py-2 text-sm font-semibold text-violet-bright hover:bg-violet/10 focus-ring"
              >
                {EMPTY[tab].action}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setTab(EMPTY[tab].tab!)}
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md border border-violet/50 px-4 py-2 text-sm font-semibold text-violet-bright hover:bg-violet/10 focus-ring"
              >
                {EMPTY[tab].action}
              </button>
            )}
          </div>
        )}
      </div>

      {tab === 'todo' && (
        <section className="mt-6 border border-violet/30 bg-obsidian p-4" aria-labelledby="inspections-due-heading">
          <h2 id="inspections-due-heading" className="font-heading text-lg font-semibold text-ivory">
            Inspections due
          </h2>
          {dueInspection ? (
            <>
              <p className="mt-1 break-words text-sm text-ivory/70">
                {dueInspection.assetName} ·{' '}
                {dueInspection.due === 'overdue'
                  ? `${Math.abs(dueInspection.days ?? 0)} days overdue`
                  : `due in ${dueInspection.days ?? 0} days`}
              </p>
              <p className="mt-1 text-xs text-ivory/50">
                Inspector: {dueInspection.inspectorName ?? 'Unassigned'}
              </p>
              <div className="mt-3">
                <InspectionForm inspection={dueInspection} collegeId={collegeId} onSaved={() => void reload()} />
              </div>
            </>
          ) : (
            <div className="mt-3">
              <p className="text-sm text-ivory/70">No inspection is due for you right now.</p>
              <Link
                to="/dashboard/inspections"
                className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md border border-violet/50 px-4 py-2 text-sm font-semibold text-violet-bright hover:bg-violet/10 focus-ring"
              >
                Open inspections
              </Link>
            </div>
          )}
        </section>
      )}

      <Modal
        open={Boolean(details)}
        title="Why this job is here"
        description="These are the recorded points behind the one-line reason. The same priority points order the staff lists."
        onClose={() => setDetails(null)}
        size="md"
      >
        {details && (
          <div>
            <p className="text-sm text-ivory/75">{details.reason}</p>
            {details.priority && (
              <>
                <p className="mt-4 font-mono text-[0.6875rem] uppercase tracking-widest text-gold">
                  Priority points {details.priority.score} · {details.priority.bandLabel}
                </p>
                <ul className="mt-2 divide-y divide-violet/20 border-y border-violet/25">
                  {details.priority.components.map((component) => (
                    <li key={component.key} className="py-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-medium text-ivory">{component.label}</p>
                        <p className="font-mono text-sm text-ivory">
                          {component.available ? `${component.points} ${component.points === 1 ? 'pt' : 'pts'}` : 'not recorded'}
                        </p>
                      </div>
                      <p className="mt-0.5 break-words text-xs leading-relaxed text-ivory/60">{component.detail}</p>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs leading-relaxed text-ivory/45">
                  Priority points help order the work. They are not a safety assessment or a promise of how long a repair
                  takes.
                </p>
                <p className="mt-2 text-xs leading-relaxed text-ivory/45">
                  People affected is the number the reporter entered, not an estimate. Repeat counts include every
                  report in this college, but you only ever see your own jobs.
                </p>
              </>
            )}
            <button
              type="button"
              onClick={() => setDetails(null)}
              className="mt-5 min-h-11 w-full rounded-md bg-violet px-4 py-2 text-sm font-semibold text-ivory focus-ring"
            >
              Close
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
