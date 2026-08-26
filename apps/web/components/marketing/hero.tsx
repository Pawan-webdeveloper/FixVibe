import Link from 'next/link'
import { HeroMatrix } from './hero-matrix.tsx'
import { HeroScanForm } from './hero-scan-form.tsx'
import { BrandMark } from './brand-mark.tsx'
import { Bot, Search, ShieldCheck } from './icons.tsx'
import { TOTAL_CHECKS } from './coverage.ts'

/**
 * The hero.
 *
 * A security terminal: one saturated brand block, near-black monospace on top
 * of it, and nothing else. Every colour resolves through the HERO TOKENS block
 * in globals.css — CHANGE THE BRAND COLOUR THERE, and the headline copy in
 * HEADLINE below. No value in this file is a colour.
 *
 * The whole surface is one page-sized terminal window: a 1px frame insetting
 * the section, a nav band across the top, a scanning field in the space below
 * it, and a section label along the bottom edge. Square corners everywhere —
 * a radius anywhere in here reads as a different product.
 *
 * This is the only chrome on the landing page, which is why the nav lives
 * inside the frame rather than above it: the shared SiteHeader would be a
 * second navigation on a screen that already has one.
 */

/** Two lines, kept whole. The brackets are type, not decoration. */
const HEADLINE = ['[ Ship it.', 'Then actually check it. ]'] as const

/** Only destinations that exist. Adding a page is one line here. */
const NAV_LINKS: readonly { readonly href: string; readonly label: string }[] = [
  { href: '/#checks', label: 'Checks' },
  { href: '/#faq', label: 'FAQ' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/login', label: 'Sign in' },
]

const PILLARS = [
  { Icon: ShieldCheck, label: 'Security' },
  { Icon: Search, label: 'SEO' },
  { Icon: Bot, label: 'AEO' },
] as const

/** Fixed widths: a barcode drawn from Math.random would differ on every render. */
const BARCODE = [3, 1, 1, 2, 1, 4, 1, 1, 2, 3, 1, 1, 2, 4, 1, 2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 4, 1, 1] as const

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.14em]'

export function Hero() {
  return (
    <section className="hero flex min-h-[100svh] bg-brand p-3 text-hero-ink sm:p-4">
      <div className="relative flex flex-1 flex-col">
        {/* The frame, as an overlay rather than a border on the flex column, so
            it can clip-reveal on load without clipping the content inside it. */}
        <div
          aria-hidden="true"
          className="hero-frame-in pointer-events-none absolute inset-0 z-20 border border-hero-ink"
        />

        <HeroNav />

        <div className="relative flex flex-1 flex-col justify-end">
          {/* The field owns the space between the nav and the wordmark, and
              fades out through the headline. It stops before the sub-copy:
              dimmed text over a glyph field is the one trade this design is
              not worth making. */}
          <div className="relative flex min-h-[12vh] flex-1 flex-col justify-end px-4 pt-[10vh] sm:px-8 lg:px-12">
            <HeroMatrix className="hero-field-mask inset-0" />

            <div className="relative z-10">
              <Wordmark />

              <h1
                className="mt-8 font-mono font-extrabold tracking-[-0.03em]"
                style={{ fontSize: 'clamp(40px, 7vw, 92px)', lineHeight: 0.98 }}
              >
                {HEADLINE.map((line, index) => (
                  <span
                    key={line}
                    className="hero-line-in block"
                    style={{ animationDelay: `${index * 90}ms` }}
                  >
                    {line}
                  </span>
                ))}
              </h1>
            </div>
          </div>

          <div className="relative z-10 px-4 pb-10 sm:px-8 sm:pb-12 lg:px-12">
            <p
              className={`hero-rise mt-7 max-w-[64ch] font-mono text-xs leading-relaxed tracking-[0.04em]
                          text-hero-ink-dim uppercase sm:text-sm`}
            >
              Paste a URL. In under a minute, get {TOTAL_CHECKS} security, SEO, and AEO checks —
              each with a copy-paste fix prompt for your AI editor.
            </p>
            <p className="hero-rise mt-3 font-mono text-xs tracking-[0.22em] text-hero-ink-dim uppercase">
              No account needed to scan.
            </p>

            <div id="scan" className="hero-rise mt-9 max-w-3xl scroll-mt-24">
              <HeroScanForm />
            </div>
          </div>
        </div>

        <div
          className={`relative z-10 flex items-center justify-between gap-4 border-t border-hero-ink
                      px-4 py-2.5 sm:px-8 ${LABEL}`}
        >
          <span>
            [ 01 ] The report
            <span className="hidden sm:inline"> — what {TOTAL_CHECKS} checks come back with</span>
          </span>
          <a href="#report" className="hero-link relative">
            Scroll ↓
          </a>
        </div>
      </div>
    </section>
  )
}

function HeroNav() {
  return (
    <nav
      aria-label="Main"
      className="relative z-30 flex items-center gap-4 border-b border-hero-ink px-4 py-3 sm:px-8"
    >
      <Link href="/" className="flex items-center gap-2" aria-label="Darvin — home">
        <BrandMark size={16} track="rgb(var(--hero-ink-rgb) / 0.28)" arc="var(--hero-ink)" />
        <span className="font-mono text-sm font-semibold tracking-tight">darvin</span>
      </Link>

      <div className="flex-1" />

      <ul className={`hidden items-center gap-6 md:flex ${LABEL}`}>
        {NAV_LINKS.map(({ href, label }) => (
          <li key={href}>
            <Link href={href} className="hero-link relative">
              {label}
            </Link>
          </li>
        ))}
      </ul>

      <a href="#scan" className={`hero-link relative hidden sm:inline ${LABEL}`}>
        Scan a site →
      </a>

      {/* A disclosure, not a scripted menu: it is a real button, it is keyboard
          operable, it closes on Escape, and it ships no JavaScript. */}
      <details className="hero-menu relative md:hidden">
        <summary
          aria-label="Open menu"
          className="flex size-8 cursor-pointer items-center justify-center border border-hero-ink"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 7h16" />
            <path d="M4 12h16" />
            <path d="M4 17h16" />
          </svg>
        </summary>
        <ul className={`absolute right-0 top-10 z-40 w-48 border border-hero-ink bg-brand ${LABEL}`}>
          {[...NAV_LINKS, { href: '/#scan', label: 'Scan a site →' }].map(({ href, label }) => (
            <li key={href} className="border-b border-hero-ink last:border-0">
              <Link href={href} className="block px-4 py-3">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </details>
    </nav>
  )
}

function Wordmark() {
  return (
    <div className="hero-rise flex items-center justify-between gap-4 border border-hero-ink bg-brand px-4 py-3">
      <div className="flex items-center gap-3">
        <BrandMark size={20} track="rgb(var(--hero-ink-rgb) / 0.28)" arc="var(--hero-ink)" />
        <span className="font-mono text-base font-semibold tracking-tight sm:text-lg">DARVIN</span>
        <span className={`border border-hero-ink px-1.5 py-0.5 ${LABEL}`}>Beta</span>
      </div>

      <ul className={`hidden items-center gap-5 lg:flex ${LABEL}`}>
        {PILLARS.map(({ Icon, label }) => (
          <li key={label} className="flex items-center gap-1.5">
            <Icon size={14} />
            {label}
          </li>
        ))}
      </ul>

      <div aria-hidden="true" className="hidden h-6 items-stretch gap-[2px] sm:flex">
        {BARCODE.map((width, index) => (
          <span key={index} style={{ width: `${width}px` }} className="bg-hero-ink" />
        ))}
      </div>
    </div>
  )
}
