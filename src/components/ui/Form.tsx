import type { ReactNode } from 'react'

export const inputClass =
  'w-full rounded-md border border-violet/40 bg-ink px-3 py-2 text-sm text-ivory placeholder:text-ivory/30 focus-ring disabled:opacity-50'

export const labelClass =
  'mb-1 block font-mono text-[0.6875rem] uppercase tracking-widest text-violet-bright/80'

export const helpClass = 'mt-1 text-xs leading-relaxed text-ivory/45'

export function Field({
  label,
  htmlFor,
  required,
  help,
  error,
  children,
  className = '',
}: {
  label: string
  htmlFor?: string
  required?: boolean
  help?: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className={labelClass}>
        {label}
        {required && (
          <span className="ml-1 text-gold" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {help && !error && <p className={helpClass}>{help}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs text-status-error-dark">
          {error}
        </p>
      )}
    </div>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="border border-status-error-dark/50 bg-status-error-dark/10 px-3 py-2 text-sm text-status-error-dark">
      {message}
    </p>
  )
}

export function FormActions({
  busy,
  submitLabel,
  onCancel,
  busyLabel = 'Saving…',
}: {
  busy: boolean
  submitLabel: string
  onCancel: () => void
  busyLabel?: string
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-violet/30 pt-4">
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded-md border border-violet/40 px-4 py-2 text-sm text-ivory/80 hover:bg-violet/15 focus-ring disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-violet px-4 py-2 text-sm font-semibold text-ivory hover:bg-violet/85 focus-ring disabled:opacity-50"
      >
        {busy ? busyLabel : submitLabel}
      </button>
    </div>
  )
}
