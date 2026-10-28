import { useState } from 'react'
import Modal from './Modal'
import { ApiError } from '../../lib/api'
import Notice from './Notice'

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The action did not complete.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <p className="text-sm leading-relaxed text-ivory/75">{message}</p>
        <div className="flex justify-end gap-3 border-t border-violet/30 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-violet/40 px-4 py-2 text-sm text-ivory/80 hover:bg-violet/15 focus-ring disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className="rounded-md border border-status-error-dark/70 bg-status-error-dark/15 px-4 py-2 text-sm font-semibold text-status-error-dark hover:bg-status-error-dark/25 focus-ring disabled:opacity-50"
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
