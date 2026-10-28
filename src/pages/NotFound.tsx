import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="theme-workspace flex min-h-screen flex-col items-center justify-center bg-ink px-6 text-center text-ivory">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-gold">
        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 border-2 border-gold" />
        Error 404
      </p>
      <h1 className="mt-3 font-heading text-3xl font-bold tracking-tight text-ivory md:text-4xl">
        Page not found
      </h1>
      <p className="mt-3 max-w-md leading-relaxed text-ivory/70">
        The page you are looking for does not exist or has moved.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          to="/dashboard"
          className="rounded-md bg-violet px-5 py-2.5 text-sm font-medium text-ivory transition-colors hover:bg-[#4638e8] focus-ring"
        >
          Go to dashboard
        </Link>
        <Link
          to="/"
          className="rounded-md border border-ivory/50 px-5 py-2.5 text-sm font-medium text-ivory transition-colors hover:bg-ivory/5 focus-ring"
        >
          Back to home
        </Link>
      </div>
    </div>
  )
}
