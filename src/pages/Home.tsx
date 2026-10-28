import { Link } from 'react-router-dom'

const roles = [
  {
    key: 'student',
    name: 'Student',
    line: 'Report a problem in your classroom, lab or hostel.',
  },
  {
    key: 'faculty',
    name: 'Faculty',
    line: 'Report issues and follow the repairs that affect your classes.',
  },
  {
    key: 'maintenance',
    name: 'Maintenance',
    line: 'See your assigned jobs and update them as you work.',
  },
  {
    key: 'estates',
    name: 'Estates',
    line: 'Keep the campus records, meters and readings in order.',
  },
  {
    key: 'admin',
    name: 'Admin',
    line: 'Manage people, roles and the decisions for your college.',
  },
] as const

const steps = [
  { title: 'Sign in with your college code', detail: 'Your college gives you the code when you join.' },
  { title: 'Press Report a problem', detail: 'It sits at the top of the Issues page.' },
  { title: 'Pick what and where, add a photo', detail: 'Say what is wrong and choose the building or room.' },
  { title: 'Watch the status', detail: 'Open or in progress, then resolved when the work is done.' },
] as const

const navItems = [
  { label: 'Home', href: '#home' },
  { label: 'What is MicroCity', href: '#what' },
  { label: 'How to use', href: '#how' },
] as const

export default function Home() {
  return (
    <div id="home" className="min-h-screen bg-ink">
      <div className="landing-hero">
        <header className="border-b border-ivory/15">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-5 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
            <p className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight text-ivory">
              <span className="h-2 w-2 bg-gold" aria-hidden="true" />
              MicroCity
            </p>
            <nav aria-label="Main" className="flex flex-wrap items-center gap-x-1 gap-y-1">
              {navItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="inline-flex min-h-11 items-center px-3 text-sm text-ivory/70 transition-colors hover:text-ivory focus-ring"
                >
                  {item.label}
                </a>
              ))}
              <Link
                to="/signin"
                className="inline-flex min-h-11 items-center rounded-md bg-violet px-4 text-sm font-semibold text-ivory transition-colors hover:bg-violet/85 focus-ring"
              >
                Sign in
              </Link>
            </nav>
          </div>
        </header>

        <section className="mx-auto grid w-full max-w-7xl gap-10 px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:gap-14 lg:pb-24">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold">Campus infrastructure, made visible</p>
            <h1 className="mt-5 max-w-2xl font-heading text-4xl font-semibold leading-[1.05] tracking-tight text-ivory sm:text-5xl lg:text-6xl">
              See what your campus needs. Fix what is broken.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ivory/70">
              Report a problem, follow the repair, and plan the work your campus needs next — all in one place.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/signin"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-violet px-6 text-sm font-semibold text-ivory transition-colors hover:bg-violet/85 focus-ring"
              >
                Sign in
              </Link>
              <a
                href="#how"
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-ivory/40 px-6 text-sm font-semibold text-ivory transition-colors hover:bg-ivory/10 focus-ring"
              >
                How it works
              </a>
            </div>
          </div>

          <div
            role="img"
            aria-label="Placeholder for a MicroCity product screenshot or short recording"
            className="border border-violet/50 bg-obsidian p-3 shadow-2xl shadow-black/40"
          >
            <div className="flex aspect-[4/3] flex-col items-center justify-center gap-4 border border-dashed border-ivory/25 bg-ink/60 px-6 text-center">
              <span
                aria-hidden="true"
                className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-gold/70 text-gold"
              >
                <svg viewBox="0 0 24 24" className="ml-1 h-6 w-6" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold">Screenshot placeholder</p>
              <p className="max-w-xs text-sm leading-relaxed text-ivory/60">
                A screenshot or short recording of the workspace will appear here.
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="theme-workspace bg-ink text-ivory">
        <section id="what" className="mx-auto w-full max-w-7xl scroll-mt-8 px-5 py-16 sm:px-8 sm:py-20">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold">What is MicroCity</p>
          <h2 className="mt-3 max-w-2xl font-heading text-3xl font-semibold tracking-tight md:text-4xl">
            One place to report, repair and plan.
          </h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              {
                n: '01',
                title: 'Report',
                text: 'Students and staff report a problem in a few taps, with a photo and a location.',
              },
              {
                n: '02',
                title: 'Track and fix',
                text: 'Maintenance sees what is assigned, updates the status and keeps a record of the fix.',
              },
              {
                n: '03',
                title: 'Plan',
                text: 'Leaders see the evidence, compare options and record the decision.',
              },
            ].map((card) => (
              <article key={card.title} className="border border-violet/30 bg-obsidian p-6">
                <p className="font-mono text-xs tracking-[0.2em] text-gold">{card.n}</p>
                <h3 className="mt-4 font-heading text-2xl font-semibold">{card.title}</h3>
                <p className="mt-3 text-base leading-relaxed text-ivory/70">{card.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="who" className="border-t border-violet/20 bg-[#efe9da]">
          <div className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold">Who are you?</p>
            <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-4xl">
              Pick your role to sign in.
            </h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {roles.map((role) => (
                <article key={role.key} className="flex flex-col border border-violet/30 bg-obsidian p-6">
                  <h3 className="font-heading text-xl font-semibold">{role.name}</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-ivory/70">{role.line}</p>
                  <Link
                    to={`/signin?role=${role.key}`}
                    className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md border border-violet/50 px-4 text-sm font-semibold text-violet-bright transition-colors hover:bg-violet/10 focus-ring"
                  >
                    Sign in as {role.name}
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="mx-auto w-full max-w-7xl scroll-mt-8 px-5 py-16 sm:px-8 sm:py-20">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-gold">How to use it</p>
          <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight md:text-4xl">
            Four steps for a student.
          </h2>
          <ol className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {steps.map((step, index) => (
              <li key={step.title} className="border-t-2 border-violet/50 bg-obsidian p-5">
                <p className="font-mono text-xs tracking-[0.2em] text-gold">{String(index + 1).padStart(2, '0')}</p>
                <h3 className="mt-3 text-lg font-semibold leading-snug">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ivory/70">{step.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        <footer className="border-t border-violet/20 px-5 py-8 text-center sm:px-8">
          <p className="text-sm text-ivory/70">MicroCity uses demonstration data in this workspace.</p>
        </footer>
      </div>
    </div>
  )
}
