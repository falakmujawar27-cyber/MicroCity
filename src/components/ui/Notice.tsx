import type { ReactNode } from 'react'

type NoticeTone = 'info' | 'warning' | 'danger' | 'success'

const TONES: Record<NoticeTone, { box: string; label: string; icon: string; title: string }> = {
  info: {
    box: 'border-violet/40 bg-violet/10',
    label: 'text-violet-bright',
    icon: 'i',
    title: 'Information',
  },
  warning: {
    box: 'border-gold/50 bg-gold/10',
    label: 'text-gold',
    icon: '!',
    title: 'Attention',
  },
  danger: {
    box: 'border-status-error-dark/50 bg-status-error-dark/10',
    label: 'text-status-error-dark',
    icon: '×',
    title: 'Problem',
  },
  success: {
    box: 'border-status-ok-dark/50 bg-status-ok-dark/10',
    label: 'text-status-ok-dark',
    icon: '✓',
    title: 'Done',
  },
}

export default function Notice({
  tone = 'info',
  title,
  children,
  className = '',
}: {
  tone?: NoticeTone
  title?: string
  children: ReactNode
  className?: string
}) {
  const style = TONES[tone]
  return (
    <div className={`border px-4 py-3 text-sm ${style.box} ${className}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <div className={`flex items-center gap-2 font-mono text-[0.625rem] uppercase tracking-widest ${style.label}`}>
        <span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center border border-current text-[0.625rem]">
          {style.icon}
        </span>
        {title ?? style.title}
      </div>
      <div className="mt-2 leading-relaxed text-ivory/75">{children}</div>
    </div>
  )
}
