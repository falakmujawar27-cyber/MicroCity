import type { ReactNode } from 'react'
import Notice from './Notice'

export function EmptyPanel({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border border-dashed border-violet/30 px-5 py-8 text-center">
      <p className="font-heading text-lg text-ivory/80">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-ivory/50">{children}</div>}
    </div>
  )
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="space-y-3">
      <Notice tone="danger">{message}</Notice>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-violet/40 px-4 py-2 text-sm text-ivory/80 hover:bg-violet/15 focus-ring"
        >
          Retry
        </button>
      )}
    </div>
  )
}
