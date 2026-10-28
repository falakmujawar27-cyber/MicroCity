import type { ReactNode } from 'react'

interface PanelProps {
  children: ReactNode
  title?: ReactNode
  kicker?: string
  actions?: ReactNode
  className?: string
  /** 'default' = obsidian panel; 'plain' = transparent section. */
  tone?: 'default' | 'plain'
}

export default function Panel({ children, title, kicker, actions, className = '', tone = 'default' }: PanelProps) {
  const base =
    tone === 'default'
      ? 'min-w-0 border border-violet/30 bg-obsidian'
      : 'min-w-0 border-t border-violet/30 pt-6'
  return (
    <section className={`${base} ${className}`}>
      {(title || actions || kicker) && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-0 pt-5 md:px-6">
          <div>
            {kicker && (
              <p className="font-mono text-[0.6875rem] uppercase tracking-widest text-gold">{kicker}</p>
            )}
            {title && (
              <h2 className="mt-1 font-heading text-xl font-semibold text-ivory md:text-2xl">{title}</h2>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={title || actions || kicker ? 'p-5 md:p-6' : 'p-5 md:p-6'}>{children}</div>
    </section>
  )
}
