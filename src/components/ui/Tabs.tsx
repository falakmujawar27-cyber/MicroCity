interface TabItem {
  id: string
  label: string
  count?: number
}

export default function Tabs({
  tabs,
  active,
  onChange,
  label = 'Sections',
}: {
  tabs: TabItem[]
  active: string
  onChange: (id: string) => void
  label?: string
}) {
  return (
    <div className="overflow-x-auto border-b border-violet/30" role="tablist" aria-label={label}>
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const selected = tab.id === active
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(tab.id)}
              className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm transition-colors focus-ring ${
                selected
                  ? 'border-gold text-ivory'
                  : 'border-transparent text-ivory/55 hover:border-violet/50 hover:text-ivory'
              }`}
            >
              {tab.label}
              {typeof tab.count === 'number' && (
                <span className="ml-2 font-mono text-[0.6875rem] text-gold/80">{tab.count}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
