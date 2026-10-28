const CURRENT_YEAR = new Date().getFullYear()

export function Footer() {
  return (
    <footer className="border-t border-violet/30 bg-ink text-ivory py-16 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
          <div className="flex items-start gap-2">
            <span className="font-heading text-lg font-semibold tracking-tighter block">
              MicroCity
            </span>
            <p className="text-xs text-ivory/50 leading-relaxed max-w-xs mt-1">
              Campus infrastructure planning &amp; management for colleges.
            </p>
          </div>
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-ivory/50">
              <span>&copy; {CURRENT_YEAR} MicroCity</span>
              <span className="w-1 h-1 bg-violet-bright/50 rounded-full" aria-hidden="true" />
              <span>Synthetic demonstration workspace — not a real college.</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
