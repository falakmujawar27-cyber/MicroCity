import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import Modal from './Modal'
import { Field, FormActions, FormError, inputClass } from './Form'
import { api, ApiError } from '../../lib/api'
import { isoDateOnly, toDateTimeLocal, fromDateTimeLocal } from '../../lib/format'

export interface FormField {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'integer' | 'date' | 'datetime' | 'select' | 'photo'
  required?: boolean
  options?: { value: string; label: string }[] | ((values: Record<string, string>) => { value: string; label: string }[])
  help?: string
  placeholder?: string
  columnSpan?: 1 | 2
  /** Hide when editing an existing record (e.g. photos are create-only). */
  createOnly?: boolean
  /** Hide the field unless the current values meet this condition. */
  showWhen?: (values: Record<string, string>) => boolean
  /** Minimum number of characters accepted for text fields. */
  minLength?: number
}

interface RecordDialogProps {
  open: boolean
  onClose: () => void
  entity: string
  title: string
  description?: string
  fields: FormField[]
  initial?: Record<string, unknown> | null
  onSaved: () => void | Promise<void>
  size?: 'md' | 'lg' | 'xl'
}

function optionsFor(field: FormField, values: Record<string, string>): { value: string; label: string }[] {
  if (typeof field.options === 'function') return field.options(values)
  return field.options ?? []
}

function initialValues(fields: FormField[], initial: Record<string, unknown> | null): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) {
    if (field.type === 'photo') continue
    const raw = initial?.[field.key]
    if (raw === null || raw === undefined) {
      values[field.key] = ''
    } else if (field.type === 'datetime') {
      values[field.key] = toDateTimeLocal(String(raw))
    } else if (field.type === 'date') {
      values[field.key] = isoDateOnly(String(raw))
    } else {
      values[field.key] = String(raw)
    }
  }
  return values
}

export default function RecordDialog({
  open,
  onClose,
  entity,
  title,
  description,
  fields,
  initial = null,
  onSaved,
  size = 'lg',
}: RecordDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(fields, initial))
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState<{ name: string; dataUrl: string } | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const editing = typeof initial?.id === 'string'

  useEffect(() => {
    if (!open) return
    setValues(initialValues(fields, initial))
    setFieldErrors({})
    setFormError(null)
    setPhoto(null)
    setPhotoError(null)
    // fields are configuration constants per page; initial identity drives resets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const set = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const onPhoto = (file: File | null) => {
    setPhotoError(null)
    if (!file) {
      setPhoto(null)
      return
    }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setPhotoError('Choose a PNG, JPEG or WebP image.')
      return
    }
    if (file.size > 1_100_000) {
      setPhotoError('Photo is too large. Choose an image under about 1.1 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setPhoto({ name: file.name, dataUrl: String(reader.result) })
    }
    reader.onerror = () => setPhotoError('The photo could not be read.')
    reader.readAsDataURL(file)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const errors: Record<string, string> = {}
    const payload: Record<string, unknown> = {}
    for (const field of fields) {
      if (field.type === 'photo') continue
      if (editing && field.createOnly) continue
      if (field.showWhen && !field.showWhen(values)) {
        if (!editing) payload[field.key] = null
        continue
      }
      const raw = (values[field.key] ?? '').trim()
      if (!raw) {
        if (field.required) errors[field.key] = `${field.label} is required.`
        else payload[field.key] = null
        continue
      }
      if (field.minLength && raw.length < field.minLength) {
        errors[field.key] = `${field.label} needs at least ${field.minLength} characters.`
        continue
      }
      if (field.type === 'number' || field.type === 'integer') {
        const numeric = Number(raw)
        if (!Number.isFinite(numeric)) {
          errors[field.key] = `${field.label} must be a number.`
        } else if (field.type === 'integer' && !Number.isInteger(numeric)) {
          errors[field.key] = `${field.label} must be a whole number.`
        } else if (numeric < 0) {
          errors[field.key] = `${field.label} cannot be negative.`
        } else {
          payload[field.key] = numeric
        }
      } else if (field.type === 'datetime') {
        payload[field.key] = fromDateTimeLocal(raw) ?? raw
      } else {
        payload[field.key] = raw
      }
    }
    if (photo) {
      payload.photoName = photo.name
      payload.photoDataUrl = photo.dataUrl
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setFormError('Some fields need attention before saving.')
      return
    }

    setBusy(true)
    setFormError(null)
    try {
      if (editing && initial && typeof initial.id === 'string') {
        await api.updateRecord(entity, initial.id, payload)
      } else {
        await api.createRecord(entity, payload)
      }
      await onSaved()
      onClose()
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors)
        setFormError(err.message)
      } else {
        setFormError('The record could not be saved. Try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} description={description} size={size}>
      <form onSubmit={submit} className="space-y-4">
        <FormError message={formError} />
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => {
            if (editing && field.createOnly) return null
            if (field.showWhen && !field.showWhen(values)) return null
            const id = `field-${field.key}`
            const error = fieldErrors[field.key]
            const options = optionsFor(field, values)
            const span = field.columnSpan === 2 || field.type === 'textarea' || field.type === 'photo' ? 'sm:col-span-2' : ''
            if (field.type === 'photo') {
              return (
                <Field key={field.key} label={field.label} htmlFor={id} help={field.help} error={photoError ?? undefined} className={span}>
                  <input
                    id={id}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => onPhoto(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-ivory/70 file:mr-3 file:rounded-md file:border-0 file:bg-violet file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ivory hover:file:bg-violet/85"
                  />
                  {photo && (
                    <div className="mt-2 flex items-center gap-3">
                      <img src={photo.dataUrl} alt="Selected photo preview" className="h-16 w-16 border border-violet/40 object-cover" />
                      <button type="button" onClick={() => setPhoto(null)} className="text-xs text-status-error-dark underline">
                        Remove photo
                      </button>
                    </div>
                  )}
                </Field>
              )
            }
            return (
              <Field key={field.key} label={field.label} htmlFor={id} required={field.required} help={field.help} error={error} className={span}>
                {field.type === 'textarea' ? (
                  <textarea
                    id={id}
                    rows={3}
                    value={values[field.key] ?? ''}
                    onChange={(e) => set(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    minLength={field.minLength}
                    className={inputClass}
                  />
                ) : field.type === 'select' ? (
                  <select
                    id={id}
                    value={values[field.key] ?? ''}
                    onChange={(e) => set(field.key, e.target.value)}
                    className={inputClass}
                  >
                    <option value="">{field.required ? 'Choose…' : 'Not recorded'}</option>
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    type={
                      field.type === 'number' || field.type === 'integer'
                        ? 'number'
                        : field.type === 'date'
                          ? 'date'
                          : field.type === 'datetime'
                            ? 'datetime-local'
                            : 'text'
                    }
                    step={field.type === 'number' ? 'any' : field.type === 'integer' ? '1' : undefined}
                    min={field.type === 'number' || field.type === 'integer' ? 0 : undefined}
                    value={values[field.key] ?? ''}
                    onChange={(e) => set(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    minLength={field.minLength}
                    className={inputClass}
                  />
                )}
              </Field>
            )
          })}
        </div>
        <FormActions
          busy={busy}
          submitLabel={editing ? 'Save changes' : 'Create record'}
          onCancel={onClose}
        />
      </form>
    </Modal>
  )
}
