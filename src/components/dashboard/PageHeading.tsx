interface PageHeadingProps {
  title: string
  description: string
  /** Small uppercase kicker shown above the title (e.g. "Campus module"). */
  kicker?: string
}

// Consistent serif page title, editorial description and arch rule
// shared by every dashboard page.
export default function PageHeading({ title, description, kicker }: PageHeadingProps) {
  return (
    <header className="mb-12">
      {kicker && (
        <div className="flex items-baseline justify-between gap-4 border-t border-violet/40 mb-9">
          <p className="pt-3 text-xs font-medium uppercase tracking-widest text-gold">
            {kicker}
          </p>
          <span
            aria-hidden="true"
            className="hidden pt-3 font-mono text-xs tracking-widest text-violet-bright/70 sm:block"
          >
            MICROCITY
          </span>
        </div>
      )}
      <h1 className="font-heading text-3xl font-bold tracking-tight text-ivory md:text-5xl">
        {title}
      </h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ivory/70">
        {description}
      </p>
      <div className="border-t border-violet/30 mt-8" aria-hidden="true" />
    </header>
  )
}
