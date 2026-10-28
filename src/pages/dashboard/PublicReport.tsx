import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/auth-context'
import { api, ApiError } from '../../lib/api'
import { URBAN_CATEGORY_LABELS } from '../../domain/types'
import type { UrbanIssue } from '../../domain/types'
import Notice from '../../components/ui/Notice'

const ISSUE_CATEGORIES = [
  'Damaged light',
  'Trip hazard',
  'Blocked drain',
  'Shelter damage',
  'Road damage',
  'Other',
] as const

const fieldClass =
  'mt-1 min-h-12 w-full rounded-md border border-violet/40 bg-obsidian px-3 py-2.5 text-base text-ivory focus-ring'

interface PhotoValue {
  name: string
  dataUrl: string
}

export default function PublicReport() {
  const { workspace, refresh } = useAuth()
  const [category, setCategory] = useState('')
  const [locationLabel, setLocationLabel] = useState('')
  const [assetId, setAssetId] = useState('')
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<PhotoValue | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const photoInput = useRef<HTMLInputElement>(null)

  if (!workspace) return null

  const data = workspace.dataset
  const assets = [...data.urbanAssets].sort((a, b) =>
    (a.name ?? a.locationLabel ?? '').localeCompare(b.name ?? b.locationLabel ?? ''),
  )
  const descriptionReady = description.trim().length >= 15
  const ready = category !== '' && locationLabel.trim() !== '' && descriptionReady

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

  const chooseAsset = (nextId: string) => {
    setAssetId(nextId)
    const asset = data.urbanAssets.find((item) => item.id === nextId)
    if (asset && asset.locationLabel && locationLabel.trim() === '') {
      setLocationLabel(asset.locationLabel)
    }
  }

  const submit = async () => {
    setError(null)
    if (!ready) {
      setError('Choose a category, add a location and describe the issue in at least 15 characters.')
      return
    }
    setBusy(true)
    try {
      await api.createRecord<UrbanIssue>('urbanIssues', {
        category,
        severity: 'medium',
        urbanAssetId: assetId || null,
        locationLabel: locationLabel.trim(),
        authority: null,
        description: description.trim(),
        note: null,
        photoName: photo?.name ?? null,
        photoDataUrl: photo?.dataUrl ?? null,
      })
      setDone(true)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The public issue was not submitted. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div>
        <div className="border border-violet/40 bg-obsidian p-6">
          <p className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">Public issue reported</p>
          <p className="mt-3 font-heading text-xl font-semibold leading-snug text-ivory">
            Your issue is now visible to every college. Staff can update its status.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/dashboard"
              className="inline-flex min-h-12 items-center justify-center rounded-md bg-violet px-5 py-3 text-sm font-semibold text-white focus-ring"
            >
              Back to home
            </Link>
            <button
              type="button"
              onClick={() => {
                setDone(false)
                setCategory('')
                setLocationLabel('')
                setAssetId('')
                setDescription('')
                setPhoto(null)
              }}
              className="inline-flex min-h-12 items-center justify-center rounded-md border border-violet/40 px-5 py-3 text-sm font-semibold text-ivory/80 hover:bg-violet/10 focus-ring"
            >
              Report another issue
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/dashboard"
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm font-medium text-ivory/75 hover:text-ivory focus-ring"
        >
          <span aria-hidden="true">←</span> Home
        </Link>
        <span className="font-mono text-[0.625rem] uppercase tracking-widest text-gold">Shared with all colleges</span>
      </div>

      <h1 className="mt-4 font-heading text-2xl font-semibold leading-tight text-ivory">
        Report a public issue
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ivory/65">
        Street lighting, footways, drains and other public infrastructure near campus. Public reports are shared,
        so do not include personal details.
      </p>

      <div className="mt-5">
        <label htmlFor="public-category" className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">
          What is the issue?
        </label>
        <select
          id="public-category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className={fieldClass}
        >
          <option value="">Choose an issue type</option>
          {ISSUE_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      <div className="mt-4">
        <label htmlFor="public-location" className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">
          Where is it?
        </label>
        <input
          id="public-location"
          type="text"
          value={locationLabel}
          onChange={(event) => setLocationLabel(event.target.value)}
          placeholder="Street, junction or landmark"
          maxLength={160}
          className={fieldClass}
        />
      </div>

      <div className="mt-4">
        <label htmlFor="public-asset" className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">
          Nearby public asset (optional)
        </label>
        <select
          id="public-asset"
          value={assetId}
          onChange={(event) => chooseAsset(event.target.value)}
          className={fieldClass}
        >
          <option value="">Not linked to a recorded asset</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name ?? URBAN_CATEGORY_LABELS[asset.category]} — {asset.locationLabel ?? 'location not recorded'}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <label htmlFor="public-description" className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">
          What can you see?
        </label>
        <textarea
          id="public-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          placeholder="Say what is wrong, how long it has been there, and anything unsafe."
          className="mt-1 w-full rounded-md border border-violet/40 bg-obsidian px-3 py-3 text-base leading-relaxed text-ivory focus-ring"
        />
        <div className="mt-1 flex items-center justify-between gap-3 text-xs text-ivory/50">
          <span>At least 15 characters.</span>
          <span className={descriptionReady ? 'text-status-ok-dark' : ''}>
            {description.trim().length} / 15
          </span>
        </div>
      </div>

      <div className="mt-4">
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

      {error && <div className="mt-5"><Notice tone="danger">{error}</Notice></div>}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || !ready}
        className="mt-6 min-h-12 w-full rounded-md bg-violet px-5 py-3 text-base font-semibold text-white disabled:opacity-40 focus-ring"
      >
        {busy ? 'Submitting…' : 'Submit public issue'}
      </button>
      <p className="mt-3 pb-4 text-xs leading-relaxed text-ivory/45">
        This is a local demonstration. Submission does not contact a council or transport authority.
      </p>
    </div>
  )
}
