import type { ReactNode } from 'react'

type Tone = 'default' | 'critical' | 'high' | 'good'

const TONES: Record<Tone, string> = {
  default: 'border-violet/30 bg-obsidian',
  critical: 'border-status-error-dark/50 bg-status-error-dark/5',
  high: 'border-gold/50 bg-gold/5',
  good: 'border-status-ok-dark/40 bg-status-ok-dark/5',
}

export default function Stat({
  label,
  value,
  detail,
  tone = 'default',
  children,
}: {
  label: string
  value: ReactNode
  detail?: string
  tone?: Tone
  children?: ReactNode
}) {
  return (
    <div className={`border p-4 md:p-5 ${TONES[tone]}`}>
      <p className="font-mono text-[0.625rem] uppercase tracking-widest text-ivory/50">{label}</p>
      <p className="mt-2 font-heading text-3xl font-semibold leading-none text-ivory">{value}</p>
      {detail && <p className="mt-2 text-xs leading-relaxed text-ivory/55">{detail}</p>}
      {children}
    </div>
  )
}
