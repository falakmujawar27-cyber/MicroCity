import type { ReactNode } from 'react'

type Tone = 'neutral' | 'violet' | 'gold' | 'ok' | 'warn' | 'error' | 'outline'

const TONES: Record<Tone, string> = {
  neutral: 'border-ivory/25 bg-ivory/10 text-ivory/80',
  violet: 'border-violet/50 bg-violet/15 text-violet-bright',
  gold: 'border-gold/50 bg-gold/10 text-gold',
  ok: 'border-status-ok-dark/50 bg-status-ok-dark/10 text-status-ok-dark',
  warn: 'border-status-warn-dark/50 bg-status-warn-dark/10 text-status-warn-dark',
  error: 'border-status-error-dark/50 bg-status-error-dark/10 text-status-error-dark',
  outline: 'border-ivory/30 bg-transparent text-ivory/70',
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
  wrap = false,
}: {
  children: ReactNode
  tone?: Tone
  className?: string
  wrap?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${wrap ? 'whitespace-normal text-left' : 'whitespace-nowrap'} rounded border px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

const SEVERITY_TONE = {
  critical: 'error',
  high: 'warn',
  medium: 'violet',
  low: 'neutral',
  info: 'outline',
} as const

export function SeverityBadge({ severity }: { severity: string }) {
  const tone = SEVERITY_TONE[severity as keyof typeof SEVERITY_TONE] ?? 'neutral'
  const label = severity.charAt(0).toUpperCase() + severity.slice(1)
  return (
    <Badge tone={tone}>
      <span aria-hidden="true" className="text-[0.6875rem] leading-none">
        {severity === 'critical' || severity === 'high' ? '▲' : severity === 'medium' ? '◆' : '●'}
      </span>
      {label}
    </Badge>
  )
}

const STATUS_TONE: Record<string, Tone> = {
  open: 'warn',
  reported: 'warn',
  in_progress: 'violet',
  scheduled: 'violet',
  proposed: 'outline',
  resolved: 'ok',
  approved: 'ok',
  completed: 'ok',
  closed: 'neutral',
  rejected: 'error',
  cancelled: 'neutral',
  deferred: 'gold',
}

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'neutral'
  const label = status.replace(/_/g, ' ')
  return (
    <Badge tone={tone}>
      <span aria-hidden="true" className="text-[0.5625rem] leading-none">
        {status === 'resolved' || status === 'approved' || status === 'completed' ? '✓' : status === 'rejected' ? '✕' : '●'}
      </span>
      {label}
    </Badge>
  )
}
