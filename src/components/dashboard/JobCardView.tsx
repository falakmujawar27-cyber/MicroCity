import { useRef, useState } from 'react'
import { SeverityBadge } from '../ui/Badge'
import type { JobCard } from '../../domain/jobs'
import { api } from '../../lib/api'

interface Props {
  job: JobCard
  busy: boolean
  completing: boolean
  onStart: () => void
  onBeginComplete: () => void
  onCancelComplete: () => void
  onShowDetails: () => void
  onComplete?: (note: string, photo: { name: string | null; dataUrl: string | null }) => void
}

/**
 * One job, one action. A job to do offers Start; a job in progress offers Mark
 * done; a finished job offers nothing but its record.
 */
export default function JobCardView({
  job,
  busy,
  completing,
  onStart,
  onBeginComplete,
  onCancelComplete,
  onShowDetails,
  onComplete,
}: Props) {
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<{ name: string; dataUrl: string } | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const readPhoto = (file: File | undefined) => {
    setPhotoError(null)
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setPhotoError('Choose a PNG, JPEG or WebP photo.')
      return
    }
    if (file.size > 1_100_000) {
      setPhotoError('That photo is too large. Choose one under about 1.1 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setPhoto({ name: file.name.slice(0, 160), dataUrl: reader.result })
    }
    reader.onerror = () => setPhotoError('The photo could not be read. Try another file.')
    reader.readAsDataURL(file)
  }

  const reset = () => {
    setNote('')
    setPhoto(null)
    setPhotoError(null)
  }

  const noteIsLongEnough = note.trim().length >= 10

  return (
    <article className="border border-violet/30 bg-obsidian p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-heading text-lg font-semibold leading-snug text-ivory">
          {job.title}
        </h3>
        <SeverityBadge severity={job.severity} />
      </div>

      <p className="mt-1 break-words text-sm text-ivory/70">
        {job.place}
        {job.openDays !== null && ` · ${job.group === 'done' ? 'took' : 'open'} ${job.openDays} days`}
      </p>

      {job.group !== 'done' && (
        <p className="mt-1 break-words text-sm leading-relaxed text-ivory/70">
          Why here: {job.reason}.{' '}
          <button
            type="button"
            onClick={onShowDetails}
            className="font-semibold text-violet-bright underline underline-offset-2 focus-ring"
          >
            Details
          </button>
        </p>
      )}

      {job.ticketNumber && (
        <p className="mt-2 font-mono text-[0.625rem] uppercase tracking-widest text-ivory/45">
          {job.ticketNumber} · reported {job.raisedOn ?? 'date not recorded'}
        </p>
      )}

      {job.group === 'todo' && (
        <button
          type="button"
          onClick={onStart}
          disabled={busy}
          className="mt-4 min-h-14 w-full rounded-md bg-violet px-4 text-base font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:opacity-50"
        >
          Start
        </button>
      )}

      {job.group === 'progress' && !completing && (
        <button
          type="button"
          onClick={onBeginComplete}
          disabled={busy}
          className="mt-4 min-h-14 w-full rounded-md bg-violet px-4 text-base font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:opacity-50"
        >
          Mark done
        </button>
      )}

      {job.group === 'progress' && completing && (
        <form
          className="mt-4 border-t border-violet/25 pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!noteIsLongEnough || !onComplete) return
            onComplete(note.trim(), { name: photo?.name ?? null, dataUrl: photo?.dataUrl ?? null })
            reset()
          }}
        >
          <label htmlFor={`note-${job.id}`} className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">
            What did you do?
          </label>
          <textarea
            id={`note-${job.id}`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="At least 10 characters, so the college can see what was done."
            className="mt-2 w-full rounded-md border border-violet/40 bg-obsidian px-3 py-2 text-sm text-ivory focus-ring"
          />
          <p className="mt-1 text-xs text-ivory/50">{note.trim().length} characters</p>

          <p className="mt-4 font-mono text-[0.6875rem] uppercase tracking-widest text-gold">After photo (optional)</p>
          <input
            ref={fileInput}
            id={`photo-${job.id}`}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => readPhoto(event.target.files?.[0])}
            className="sr-only"
          />
          {photo ? (
            <div className="mt-2">
              <img src={photo.dataUrl} alt={`After photo: ${photo.name}`} className="max-h-48 w-full border border-violet/30 object-cover" />
              <button
                type="button"
                onClick={() => {
                  setPhoto(null)
                  if (fileInput.current) fileInput.current.value = ''
                }}
                className="mt-2 min-h-11 text-sm text-violet-bright underline underline-offset-2 focus-ring"
              >
                Remove photo
              </button>
            </div>
          ) : (
            <label
              htmlFor={`photo-${job.id}`}
              className="mt-2 inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-violet/40 px-4 text-sm text-ivory/80 hover:bg-violet/10 focus-ring"
            >
              Add a photo
            </label>
          )}
          {photoError && <p className="mt-2 text-sm text-status-error-dark">{photoError}</p>}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                reset()
                onCancelComplete()
              }}
              disabled={busy}
              className="min-h-14 rounded-md border border-violet/40 px-4 text-sm font-semibold text-ivory/80 hover:bg-violet/10 focus-ring disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!noteIsLongEnough || busy || !onComplete}
              className="min-h-14 rounded-md bg-violet px-4 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Confirm done'}
            </button>
          </div>
        </form>
      )}

      {job.group === 'done' && (
        <div className="mt-3 border-t border-violet/25 pt-3">
          {job.status === 'closed' && !job.repaired ? (
            <>
              <p className="font-mono text-[0.625rem] uppercase tracking-widest text-status-error-dark">
                Closed without repair {job.completedOn ?? 'date not recorded'} (IST)
              </p>
              <p className="mt-1 break-words text-sm leading-relaxed text-ivory/75">
                {job.closedReason ? `Estates reason: ${job.closedReason}` : 'No reason was recorded.'}
              </p>
            </>
          ) : (
            <>
              <p className="font-mono text-[0.625rem] uppercase tracking-widest text-status-ok-dark">
                Done {job.completedOn ?? 'date not recorded'} (IST)
              </p>
              <p className="mt-1 break-words text-sm leading-relaxed text-ivory/75">
                {job.completionNote ?? 'No completion note was recorded.'}
              </p>
            </>
          )}
          {job.hasCompletionPhoto && (
            <figure className="mt-2 max-w-xs">
              <img
                src={api.complaintPhotoUrl(job.id, 'completion', job.collegeId)}
                alt={`After photo${job.completionPhotoName ? `: ${job.completionPhotoName}` : ''}`}
                className="border border-violet/30 object-cover"
              />
              <figcaption className="mt-1 font-mono text-[0.5625rem] uppercase tracking-wider text-ivory/40">
                After photo — {job.completionPhotoName ?? 'unnamed'}
              </figcaption>
            </figure>
          )}
        </div>
      )}
    </article>
  )
}
