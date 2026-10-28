interface ScoreBarProps {
  value: number | null
  max?: number
  label?: string
  thresholds?: { at: number; label: string; className: string }[]
  compact?: boolean
}

/** Deterministic 0–100 score bar. Missing values stay visibly unscored. */
export default function ScoreBar({ value, max = 100, label, thresholds = [], compact = false }: ScoreBarProps) {
  if (value === null) {
    return (
      <div>
        {label && <p className="mb-1 font-mono text-[0.625rem] uppercase tracking-widest text-ivory/45">{label}</p>}
        <p className="text-xs italic text-ivory/45">Not scored — evidence missing</p>
      </div>
    )
  }
  const clamped = Math.max(0, Math.min(max, value))
  const threshold = [...thresholds].reverse().find((item) => value >= item.at)
  const barClass = threshold?.className ?? 'bg-violet'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        {label && <span className="font-mono text-[0.625rem] uppercase tracking-widest text-ivory/45">{label}</span>}
        <span className="font-mono text-xs text-ivory/80">
          {value}
          <span className="text-ivory/40">/{max}</span>
          {threshold && <span className="ml-2 text-gold">{threshold.label}</span>}
        </span>
      </div>
      <div
        className={`mt-1 w-full overflow-hidden border border-ivory/15 bg-ink ${compact ? 'h-1.5' : 'h-2'}`}
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? 'Score'}
      >
        <div className={`h-full ${barClass}`} style={{ width: `${(clamped / max) * 100}%` }} />
      </div>
    </div>
  )
}
