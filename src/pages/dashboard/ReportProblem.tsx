import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/auth-context'
import { api, ApiError } from '../../lib/api'
import { COMPLAINT_DESCRIPTION_MIN } from '../../domain/complaint-rules'
import type { Complaint } from '../../domain/types'
import Notice from '../../components/ui/Notice'

const TILES = [
  { label: 'Electrical', category: 'Electrical', hint: 'Lights, sockets, power' },
  { label: 'Water', category: 'Plumbing', hint: 'Leaks, taps, drains' },
  { label: 'Furniture', category: 'Furniture', hint: 'Desks, chairs, fittings' },
  { label: 'IT and projector', category: 'IT / network', hint: 'Network, screens, projection' },
  { label: 'Cleaning', category: 'Cleaning', hint: 'Spills, bins, toilets' },
  { label: 'Other', category: 'Other', hint: 'Anything else' },
] as const

const fieldClass =
  'mt-1 min-h-12 w-full rounded-md border border-violet/40 bg-obsidian px-3 py-2.5 text-base text-ivory focus-ring'

interface PhotoValue {
  name: string
  dataUrl: string
}

interface Suggestion {
  category: string | null
  roomId: string | null
  roomLabel: string | null
  severity: string | null
}

interface SimilarReports {
  count: number
  samples: { ticketNumber: string | null; status: string; raisedAt: string }[]
}

export default function ReportProblem() {
  const { workspace, ai, refresh } = useAuth()
  const [step, setStep] = useState(1)
  const [category, setCategory] = useState('')
  const [buildingId, setBuildingId] = useState('')
  const [roomChoice, setRoomChoice] = useState<'' | 'room' | 'not_sure'>('')
  const [roomId, setRoomId] = useState('')
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<PhotoValue | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [similar, setSimilar] = useState<SimilarReports | null>(null)
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [suggestFallback, setSuggestFallback] = useState(false)
  const [suggestionUsed, setSuggestionUsed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ticket, setTicket] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  if (!workspace) return null

  const data = workspace.dataset
  const buildings = [...data.buildings].sort((a, b) => a.name.localeCompare(b.name))
  const buildingsById = new Map(data.buildings.map((building) => [building.id, building]))
  const rooms = buildingId
    ? [...data.rooms].filter((room) => room.buildingId === buildingId).sort((a, b) => a.code.localeCompare(b.code))
    : []

  const resetRoom = (nextBuildingId: string) => {
    setBuildingId(nextBuildingId)
    setRoomId('')
    setRoomChoice('')
  }

  const canLeaveStep1 = category !== ''
  const canLeaveStep2 =
    buildingId !== '' && (roomChoice === 'not_sure' || (roomChoice === 'room' && roomId !== ''))
  const descriptionReady = description.trim().length >= COMPLAINT_DESCRIPTION_MIN

  const back = () => {
    setError(null)
    if (step > 1) setStep(step - 1)
  }

  const next = () => {
    setError(null)
    if (step === 1 && !canLeaveStep1) {
      setError('Choose what is broken to continue.')
      return
    }
    if (step === 2 && !canLeaveStep2) {
      setError(roomChoice === 'room' ? 'Choose a room, or say you are not sure.' : 'Choose the building and whether you know the room.')
      return
    }
    setStep(step + 1)
  }

  const readPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPhotoError(null)
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setPhotoError('Choose a PNG, JPEG or WebP image.')
      return
    }
    if (file.size > 1_100_000) {
      setPhotoError('That photo is too large. Choose one under about 1.1 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhoto({ name: file.name.slice(0, 160), dataUrl: reader.result })
      }
    }
    reader.onerror = () => setPhotoError('The photo could not be read. Try another file.')
    reader.readAsDataURL(file)
  }

  const suggest = async () => {
    setSuggestBusy(true)
    setSuggestError(null)
    setSuggestFallback(false)
    setSuggestionUsed(false)
    setSuggestion(null)
    setSimilar(null)
    try {
      // The server sends only the typed text plus the allowed categories,
      // rooms and severities, validates the reply against those lists and
      // computes similar reports itself. The AI never submits the report.
      const answer = await api.aiAssist({ task: 'categorise-issue', text: description.trim() })
      if (!answer.ok) {
        setSuggestError(answer.error ?? 'The assistant did not return a suggestion.')
        setSuggestFallback(true)
        return
      }
      if (answer.accepted === false || !answer.suggestion) {
        setSuggestError(
          answer.reason === 'off_list_category'
            ? 'The suggestion was not on the allowed category list, so it was discarded. Choose a category yourself.'
            : 'No valid suggestion was returned. Choose a category yourself.',
        )
        setSuggestFallback(true)
        return
      }
      setSuggestion(answer.suggestion)
      setSimilar(answer.similarReports ?? null)
    } catch (err) {
      setSuggestError(err instanceof ApiError ? err.message : 'The assistant could not be reached.')
      setSuggestFallback(true)
    } finally {
      setSuggestBusy(false)
    }
  }

  const useSuggestion = () => {
    if (!suggestion) return
    if (suggestion.category) setCategory(suggestion.category)
    if (suggestion.roomId) {
      const room = data.rooms.find((item) => item.id === suggestion.roomId)
      if (room) {
        setBuildingId(room.buildingId)
        setRoomChoice('room')
        setRoomId(room.id)
      }
    }
    setSuggestionUsed(true)
  }

  const submit = async () => {
    setError(null)
    if (!descriptionReady) {
      setError(`Add at least ${COMPLAINT_DESCRIPTION_MIN} characters describing the problem.`)
      return
    }
    if (!category || !buildingId || !roomChoice) {
      setError('Some earlier answers are missing. Go back and complete each step.')
      return
    }
    setBusy(true)
    try {
      const created = await api.createRecord<Complaint>('complaints', {
        category,
        severity: 'medium',
        buildingId,
        roomChoice,
        roomId: roomChoice === 'room' ? roomId : null,
        assetId: null,
        description: description.trim(),
        peopleAffected: null,
        photoName: photo?.name ?? null,
        photoDataUrl: photo?.dataUrl ?? null,
      })
      setTicket(created.record.ticketNumber ?? created.record.id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The report was not submitted. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (ticket) {
    return (
      <div className="min-h-[70vh]">
        <div className="border border-violet/40 bg-obsidian p-6">
          <p className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">Report received</p>
          <p className="mt-3 font-heading text-xl font-semibold leading-snug text-ivory">
            Ticket {ticket} created. You can follow it under My reports.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/dashboard/my-reports"
              className="inline-flex min-h-12 items-center justify-center rounded-md bg-violet px-5 py-3 text-sm font-semibold text-white focus-ring"
            >
              Go to My reports
            </Link>
            <Link
              to="/dashboard"
              className="inline-flex min-h-12 items-center justify-center rounded-md border border-violet/40 px-5 py-3 text-sm font-semibold text-ivory/80 hover:bg-violet/10 focus-ring"
            >
              Back to home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="-mt-6">
      <header className="sticky top-0 z-30 -mx-4 border-b border-violet/30 bg-obsidian px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={step === 1 ? () => window.history.back() : back}
            className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-ivory/75 hover:bg-violet/10 focus-ring"
          >
            <span aria-hidden="true">←</span> Back
          </button>
          <span className="truncate font-heading text-base font-semibold text-ivory">Report a problem</span>
          <span className="shrink-0 font-mono text-[0.6875rem] uppercase tracking-wider text-gold">
            Step {step} of 3
          </span>
        </div>
      </header>

      {step === 1 && (
        <section className="pt-6" aria-labelledby="step-one-heading">
          <h1 id="step-one-heading" className="font-heading text-3xl font-bold leading-tight text-ivory">
            What is broken?
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ivory/65">Choose the closest match. You can add detail next.</p>

          <div className="mt-5 grid grid-cols-2 gap-3">
            {TILES.map((tile) => {
              const selected = category === tile.category
              return (
                <button
                  key={tile.label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setCategory(tile.category)}
                  className={`flex min-h-28 flex-col items-start justify-between rounded-md border p-4 text-left focus-ring ${
                    selected
                      ? 'border-violet bg-violet/15 text-ivory'
                      : 'border-violet/35 bg-obsidian text-ivory/80 hover:border-violet/60 hover:bg-violet/5'
                  }`}
                >
                  <span className="font-heading text-base font-semibold leading-tight">{tile.label}</span>
                  <span className="mt-2 text-xs leading-snug text-ivory/55">{tile.hint}</span>
                </button>
              )
            })}
          </div>

          <p className="mt-5 border-t border-violet/25 pt-3 text-xs leading-relaxed text-ivory/55">
            Next: choose the building, then the room or “Not sure”.
          </p>

          {error && <div className="mt-5"><Notice tone="danger">{error}</Notice></div>}

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={next}
              disabled={!canLeaveStep1}
              className="min-h-12 flex-1 rounded-md bg-violet px-5 py-3 text-base font-semibold text-white disabled:opacity-40 focus-ring"
            >
              Next
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="pt-6" aria-labelledby="step-two-heading">
          <h1 id="step-two-heading" className="font-heading text-3xl font-bold leading-tight text-ivory">
            Where is it?
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ivory/65">
            Pick the building first. Then choose the room, or tell us you are not sure.
          </p>

          <div className="mt-5">
            <label htmlFor="report-building" className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">
              Building
            </label>
            <select
              id="report-building"
              value={buildingId}
              onChange={(event) => resetRoom(event.target.value)}
              className={fieldClass}
            >
              <option value="">Choose a building</option>
              {buildings.map((building) => (
                <option key={building.id} value={building.id}>{building.name}</option>
              ))}
            </select>
          </div>

          {buildingId !== '' && (
            <div className="mt-5">
              <p className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">Room</p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  aria-pressed={roomChoice === 'room'}
                  disabled={rooms.length === 0}
                  onClick={() => setRoomChoice('room')}
                  className={`min-h-12 rounded-md border px-3 py-2 text-sm font-semibold disabled:opacity-40 focus-ring ${
                    roomChoice === 'room' ? 'border-violet bg-violet/15 text-ivory' : 'border-violet/35 text-ivory/75 hover:bg-violet/5'
                  }`}
                >
                  I know the room
                </button>
                <button
                  type="button"
                  aria-pressed={roomChoice === 'not_sure'}
                  onClick={() => {
                    setRoomChoice('not_sure')
                    setRoomId('')
                  }}
                  className={`min-h-12 rounded-md border px-3 py-2 text-sm font-semibold focus-ring ${
                    roomChoice === 'not_sure' ? 'border-violet bg-violet/15 text-ivory' : 'border-violet/35 text-ivory/75 hover:bg-violet/5'
                  }`}
                >
                  Not sure
                </button>
              </div>

              {roomChoice === 'room' && (
                <>
                  <label htmlFor="report-room" className="mt-4 block font-mono text-[0.6875rem] uppercase tracking-widest text-gold">
                    Which room?
                  </label>
                  <select
                    id="report-room"
                    value={roomId}
                    onChange={(event) => setRoomId(event.target.value)}
                    className={fieldClass}
                  >
                    <option value="">Choose a room</option>
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.code}{room.name ? ` — ${room.name}` : ''}
                      </option>
                    ))}
                  </select>
                  {rooms.length === 0 && (
                    <p className="mt-2 text-xs text-ivory/55">No rooms are recorded for this building. Choose “Not sure”.</p>
                  )}
                </>
              )}

              {roomChoice === 'not_sure' && (
                <p className="mt-3 text-xs leading-relaxed text-ivory/55">
                  We will send this to the building without a room. Staff can still find it.
                </p>
              )}
            </div>
          )}

          {error && <div className="mt-5"><Notice tone="danger">{error}</Notice></div>}

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={back}
              className="min-h-12 rounded-md border border-violet/40 px-5 py-3 text-base font-semibold text-ivory/80 hover:bg-violet/10 focus-ring"
            >
              Back
            </button>
            <button
              type="button"
              onClick={next}
              disabled={!canLeaveStep2}
              className="min-h-12 flex-1 rounded-md bg-violet px-5 py-3 text-base font-semibold text-white disabled:opacity-40 focus-ring"
            >
              Next
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="pt-6" aria-labelledby="step-three-heading">
          <h1 id="step-three-heading" className="font-heading text-3xl font-bold leading-tight text-ivory">
            Details
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ivory/65">
            Tell us what you can see. Avoid naming people.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex rounded border border-violet/40 px-2 py-1 font-mono text-[0.625rem] uppercase tracking-wider text-violet-bright">
              {category}
            </span>
            <span className="inline-flex rounded border border-violet/30 px-2 py-1 font-mono text-[0.625rem] uppercase tracking-wider text-ivory/60">
              {buildingsById.get(buildingId)?.name ?? 'Building'}
              {roomChoice === 'room' && roomId
                ? ` · Room ${data.rooms.find((room) => room.id === roomId)?.code ?? ''}`
                : ' · Room not sure'}
            </span>
          </div>

          <div className="mt-5">
            <label htmlFor="report-description" className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">
              What is wrong?
            </label>
            <textarea
              id="report-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={5}
              placeholder="Say what is wrong, where, and when you noticed it."
              className="mt-1 w-full rounded-md border border-violet/40 bg-obsidian px-3 py-3 text-base leading-relaxed text-ivory focus-ring"
            />
            <div className="mt-1 flex items-center justify-between gap-3 text-xs text-ivory/50">
              <span>At least {COMPLAINT_DESCRIPTION_MIN} characters. “Broken” alone is rejected.</span>
              <span className={descriptionReady ? 'text-status-ok-dark' : ''}>
                {description.trim().length} / {COMPLAINT_DESCRIPTION_MIN}
              </span>
            </div>
          </div>

          <div className="mt-5">
            <p className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">Photo (optional)</p>
            <input
              ref={photoInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={readPhoto}
              className="sr-only"
            />
            {photo ? (
              <div className="mt-2">
                <img
                  src={photo.dataUrl}
                  alt={`Attached photo: ${photo.name}`}
                  className="max-h-48 w-full border border-violet/30 object-cover"
                />
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  className="mt-2 min-h-11 rounded-md border border-violet/40 px-3 py-2 text-sm text-ivory/75 hover:bg-violet/10 focus-ring"
                >
                  Remove photo
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => photoInput.current?.click()}
                className="mt-2 min-h-12 w-full rounded-md border border-dashed border-violet/45 px-4 py-3 text-sm font-semibold text-ivory/75 hover:bg-violet/5 focus-ring"
              >
                Add a photo
              </button>
            )}
            {photoError && <p className="mt-2 text-xs text-status-error-dark">{photoError}</p>}
          </div>

          {ai?.configured && (
            <div className="mt-5 border border-violet/30 bg-violet/5 p-4">
              <p className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">Optional assistant</p>
              <button
                type="button"
                onClick={() => void suggest()}
                disabled={!descriptionReady || suggestBusy}
                className="mt-2 min-h-11 w-full rounded-md border border-violet/45 px-4 py-2 text-sm font-semibold text-violet-bright hover:bg-violet/10 disabled:opacity-40 focus-ring"
              >
                {suggestBusy ? 'Suggesting…' : 'Suggest category and room'}
              </button>
              <p className="mt-2 text-xs leading-relaxed text-ivory/55">
                The assistant reads only what you typed and the college's recorded rooms. It never submits the report.
              </p>

              {suggestError && <p className="mt-2 text-xs text-status-error-dark">{suggestError}</p>}
              {suggestFallback && (
                <p className="mt-2 text-xs leading-relaxed text-ivory/70">
                  <span className="font-semibold">Rule-based explanation:</span> no AI suggestion was used. Review and
                  choose the category and room yourself; nothing has been submitted.
                </p>
              )}

              {suggestion && (
                <div className="mt-3 border-t border-violet/25 pt-3">
                  <p className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">
                    AI-generated, please verify
                  </p>
                  <p className="mt-2 text-sm text-ivory">
                    Category: <strong>{suggestion.category ?? 'No confident match'}</strong>
                  </p>
                  <p className="mt-1 text-sm text-ivory">
                    Room: <strong>{suggestion.roomLabel ?? 'No room suggested'}</strong>
                  </p>
                  {suggestion.severity && (
                    <p className="mt-1 text-sm text-ivory">
                      Suggested severity: <strong>{suggestion.severity}</strong> — a staff member confirms the final severity.
                    </p>
                  )}
                  {similar && similar.count > 0 && (
                    <p className="mt-2 text-xs leading-relaxed text-ivory/70">
                      Similar reports already exist: {similar.count} for this room and category
                      {similar.samples.length > 0 && (
                        <> (e.g. {similar.samples.map((sample) => sample.ticketNumber ?? 'ticket').join(', ')})</>
                      )}
                      . Computed from college records, not by the assistant.
                    </p>
                  )}
                  {suggestionUsed ? (
                    <p className="mt-2 text-xs font-semibold text-status-ok-dark">
                      Suggestion applied. Check the answers before submitting.
                    </p>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={useSuggestion}
                        className="min-h-11 flex-1 rounded-md bg-violet px-3 py-2 text-sm font-semibold text-white focus-ring"
                      >
                        Use suggestion
                      </button>
                      <button
                        type="button"
                        onClick={() => setSuggestion(null)}
                        className="min-h-11 rounded-md border border-violet/40 px-3 py-2 text-sm text-ivory/75 hover:bg-violet/10 focus-ring"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {error && <div className="mt-5"><Notice tone="danger">{error}</Notice></div>}

          <div className="mt-6 flex gap-3 pb-4">
            <button
              type="button"
              onClick={back}
              className="min-h-12 rounded-md border border-violet/40 px-5 py-3 text-base font-semibold text-ivory/80 hover:bg-violet/10 focus-ring"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !descriptionReady}
              className="min-h-12 flex-1 rounded-md bg-violet px-5 py-3 text-base font-semibold text-white disabled:opacity-40 focus-ring"
            >
              {busy ? 'Submitting…' : 'Submit report'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
