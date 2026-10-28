import { useEffect, useState, useCallback } from 'react'

interface NavSection {
  id: string
  label: string
}

interface NavbarProps {
  sections: ReadonlyArray<NavSection>
}

// Primary site navigation. Links point to sections that exist on the current page.
export function Navbar({ sections }: NavbarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [activeId, setActiveId] = useState<string | null>('home')

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.boundingClientRect.y - a.boundingClientRect.y)

        if (visible.length > 0) {
          setActiveId(visible[0].target.id)
        }
      },
      { rootMargin: '-20% 0% -60% 0%', threshold: 0 }
    )

    sections.forEach((section) => {
      const el = document.getElementById(section.id)
      if (el) observer.observe(el)
    })
    const getStartedEl = document.getElementById('get-started')
    if (getStartedEl) observer.observe(getStartedEl)

    return () => observer.disconnect()
  }, [sections])

  const scrollToSection = useCallback(
    (id: string) => {
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' })
      }
      setIsOpen(false)
    },
    []
  )

  return (
    <nav
      className={`sticky top-0 z-50 border-b border-violet/30 bg-ink transition-shadow duration-300 ${
        scrolled ? 'shadow-lg shadow-black/40' : ''
      }`}
    >
      <div className="flex items-center justify-between px-6 py-4">
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => scrollToSection('home')}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') scrollToSection('home')
          }}
        >
          <span className="h-2 w-2 bg-gold" aria-hidden="true" />
          <span className="font-heading text-lg font-semibold tracking-tighter text-ivory">
            MicroCity
          </span>
        </div>

        <div className="hidden md:flex items-center gap-6">
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              onClick={(e) => {
                e.preventDefault()
                scrollToSection(section.id)
              }}
              className={`text-sm font-medium transition-colors ${
                activeId === section.id ? 'text-violet-bright' : 'text-ivory/60'
              } hover:text-gold`}
            >
              {section.label}
            </a>
          ))}
          <a
            href="#get-started"
            onClick={(e) => {
              e.preventDefault()
              scrollToSection('get-started')
            }}
            className="text-sm font-medium transition-colors text-ivory/60 hover:text-gold"
          >
            Get Started
          </a>
        </div>

        <button
          className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-md text-ivory hover:bg-violet/20 focus-ring"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-label="Toggle navigation menu"
        >
          {isOpen ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu panel */}
      {isOpen && (
        <div className="md:hidden border-t border-violet/30 bg-obsidian text-ivory">
          <div className="px-6 py-6 space-y-3">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                className={`w-full text-left text-sm font-medium py-3 transition-colors ${
                  activeId === section.id
                    ? 'text-violet-bright'
                    : 'text-ivory/70 hover:text-ivory'
                }`}
              >
                {section.label}
              </button>
            ))}
            <button
              onClick={() => scrollToSection('get-started')}
              className="w-full text-left text-sm font-medium py-3 transition-colors text-ivory/70 hover:text-ivory"
            >
              Get Started
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}
