import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/auth-context'
import { api, ApiError } from '../../lib/api'
import InspectionForm from '../../components/dashboard/InspectionForm'
import type { InspectionCard, JobBoard } from '../../domain/jobs'

const RESULT_LABELS: Record<string, string> = {
  no_issues: 'No problems found',
  issues_found: 'Problems found',
}

function InspectionRow({
  inspection,
  collegeId,
  onSaved,
}: {
  inspection: InspectionCard
  collegeId: string | null
  onSaved: () => void
}) {
  return (
    <article className="border border-violet/30 bg-obsidian p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-heading text-lg font-semibold leading-snug text-ivory">
          {inspection.assetName}
        </h3>
        <p className="shrink-0 font-mono text-[0.625rem] uppercase tracking-widest text-gold">
          {inspection.scheduledOn ?? 'date not recorded'}
        </p>
      </div>
      <p className="mt-1 break-words text-sm text-ivory/70">
        {inspection.due === 'overdue'
          ? `${Math.abs(inspection.days ?? 0)} days overdue`
          : inspection.due === 'due-soon'
            ? `due in ${inspection.days ?? 0} days`
            : `due in ${inspection.days ?? 0} days`}
      </p>
      <div className="mt-3">
        <InspectionForm inspection={inspection} collegeId={collegeId} onSaved={onSaved} />
      </div>
    </article>
  )
}

export default function MaintenanceInspections() {
  const { workspace, role } = useAuth()
  const [board, setBoard] = useState<JobBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const collegeId = workspace?.activeCollege.id ?? null

  useEffect(() => {
    if (role !== 'maintenance' || !collegeId) return
    let cancelled = false
    void (async () => {
      try {
        const result = await api.jobBoard(collegeId)
        if (!cancelled) {
          setBoard(result)
          setError(null)
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof ApiError ? requestError.message : 'The inspections could not be loaded.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [role, collegeId, nonce])

  if (!workspace || role !== 'maintenance') return null

  const cards = board?.inspections ?? []
  const due = cards.filter((card) => card.due === 'overdue' || card.due === 'due-soon')
  const later = cards.filter((card) => card.due === 'later')
  const recorded = cards.filter((card) => card.due === 'completed')

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold leading-tight text-ivory">Inspections</h1>
        <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Maintenance</p>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ivory/65">
        Inspections scheduled for you. Recording one saves today&apos;s date on the server.
      </p>

      {error && (
        <p className="mt-3 rounded-md border border-status-error-dark/50 bg-status-error-dark/10 px-3 py-2 text-sm text-ivory">
          {error}
        </p>
      )}

      <section className="mt-6 space-y-3" aria-labelledby="due-heading">
        <h2 id="due-heading" className="font-heading text-xl font-semibold text-ivory">
          Due {due.length > 0 && <span className="text-ivory/50">({due.length})</span>}
        </h2>
        {due.map((inspection) => (
          <InspectionRow
            key={inspection.id}
            inspection={inspection}
            collegeId={collegeId}
            onSaved={() => setNonce((value) => value + 1)}
          />
        ))}
        {due.length === 0 && (
          <div className="border border-dashed border-violet/40 px-4 py-6 text-center">
            <p className="text-sm text-ivory/70">Nothing is overdue or due this week.</p>
            <Link
              to="/dashboard"
              className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md border border-violet/50 px-4 py-2 text-sm font-semibold text-violet-bright hover:bg-violet/10 focus-ring"
            >
              Back to my jobs
            </Link>
          </div>
        )}
      </section>

      {later.length > 0 && (
        <section className="mt-8 space-y-3" aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading" className="font-heading text-xl font-semibold text-ivory">
            Coming up ({later.length})
          </h2>
          {later.map((inspection) => (
            <InspectionRow
              key={inspection.id}
              inspection={inspection}
              collegeId={collegeId}
              onSaved={() => setNonce((value) => value + 1)}
            />
          ))}
        </section>
      )}

      {recorded.length > 0 && (
        <section className="mt-8 space-y-3" aria-labelledby="recorded-heading">
          <h2 id="recorded-heading" className="font-heading text-xl font-semibold text-ivory">
            Recorded ({recorded.length})
          </h2>
          <ul className="space-y-3">
            {recorded.map((inspection) => (
              <li key={inspection.id} className="border border-violet/25 bg-obsidian p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words text-sm font-medium text-ivory">{inspection.assetName}</p>
                  <p className="shrink-0 font-mono text-[0.625rem] uppercase tracking-widest text-status-ok-dark">
                    {inspection.completedOn ?? 'date not recorded'}
                  </p>
                </div>
                <p className="mt-1 text-xs text-ivory/55">
                  {inspection.result ? RESULT_LABELS[inspection.result] : 'Result not recorded'}
                </p>
                {inspection.findings && (
                  <p className="mt-1 break-words text-sm leading-relaxed text-ivory/70">{inspection.findings}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
