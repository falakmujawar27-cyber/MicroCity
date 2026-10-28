import { useState } from 'react'
import { api, ApiError } from '../../lib/api'
import type { InspectionCard } from '../../domain/jobs'
import type { InspectionResult } from '../../domain/types'

const RESULTS: { value: InspectionResult; label: string }[] = [
  { value: 'no_issues', label: 'No problems found' },
  { value: 'issues_found', label: 'Problems found' },
]

/**
 * Records the outcome of one inspection. The date is written by the server, so
 * the record cannot be back-dated from the browser.
 */
export default function InspectionForm({
  inspection,
  collegeId,
  onSaved,
}: {
  inspection: InspectionCard
  collegeId: string | null
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<InspectionResult>('no_issues')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setError(null)
        }}
        className="min-h-14 w-full rounded-md border border-violet/50 px-4 text-base font-semibold text-ivory hover:bg-violet/10 focus-ring"
      >
        Record inspection
      </button>
    )
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.recordInspection({ inspectionId: inspection.id, result, note: note.trim() }, collegeId)
      setOpen(false)
      setNote('')
      onSaved()
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : 'The inspection could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="border-t border-violet/25 pt-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (note.trim().length >= 3) void save()
      }}
    >
      <fieldset>
        <legend className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">What did you find?</legend>
        <div className="mt-2 space-y-2">
          {RESULTS.map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 items-center gap-3 rounded-md border border-violet/35 px-3 text-sm text-ivory/85"
            >
              <input
                type="radio"
                name={`result-${inspection.id}`}
                value={option.value}
                checked={result === option.value}
                onChange={() => setResult(option.value)}
                className="h-4 w-4 accent-[#5245F8]"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label
        htmlFor={`inspection-note-${inspection.id}`}
        className="mt-4 block font-mono text-[0.6875rem] uppercase tracking-widest text-gold"
      >
        Short note
      </label>
      <textarea
        id={`inspection-note-${inspection.id}`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        maxLength={500}
        placeholder="What you checked and what you saw."
        className="mt-2 w-full rounded-md border border-violet/40 bg-obsidian px-3 py-2 text-sm text-ivory focus-ring"
      />

      {error && <p className="mt-2 text-sm text-status-error-dark">{error}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          disabled={busy}
          className="min-h-14 rounded-md border border-violet/40 px-4 text-sm font-semibold text-ivory/80 hover:bg-violet/10 focus-ring disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || note.trim().length < 3}
          className="min-h-14 rounded-md bg-violet px-4 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save inspection'}
        </button>
      </div>
    </form>
  )
}
