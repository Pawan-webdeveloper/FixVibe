import Link from 'next/link'
import { BrandMark } from './brand-mark.tsx'

/**
 * Navigation for the pages a logged-out visitor sees.
 *
 * Two deliberate omissions.
 *
 * No call-to-action button. This site wants exactly one thing from a visitor —
 * a URL in the box on the page below — and a second CTA in the chrome competes
 * with it for the same click. The links here are for people who are not going
 * to scan yet.
 *
 * No session read. Calling getViewer() from the layout would opt the entire
 * (marketing) group into dynamic rendering and spend a Supabase round trip on
 * every anonymous visit, to relabel one link. The landing page is the one page
 * whose Core Web Vitals this product is judged on by its own engine, so it
 * stays static; a signed-in visitor who clicks "Sign in" lands on /login,
 * which is a harmless place to be.
 */

/** One entry per destination that actually exists. */
const NAV_LINKS: readonly { readonly href: string; readonly label: string }[] = [
  { href: '/#checks', label: 'Checks' },
  { href: '/pricing', label: 'Pricing' },
]

export function SiteHeader() {
  return (
    <header
      className="sticky top-0 z-50 border-b border-line bg-canvas supports-[backdrop-filter]:bg-canvas/72 supports-[backdrop-filter]:backdrop-blur-md"
    >
      <nav aria-label="Main" className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-6 sm:gap-6">
        <Link
          href="/"
          aria-label="Darvin — home"
          className="flex items-center gap-2 transition-opacity hover:opacity-80"
        >
          <BrandMark size={18} track="var(--line)" arc="var(--ink)" />
          <span className="text-[15px] font-semibold tracking-tight">darvin</span>
        </Link>

        <div className="flex-1" />

        <ul className="flex items-center gap-4 sm:gap-6">
          {NAV_LINKS.map(({ href, label }) => (
            <li key={href}>
              <Link href={href} className="label text-muted transition-colors hover:text-ink">
                {label}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/login"
              className="label border border-line px-3 py-2 text-ink transition-colors hover:bg-surface"
            >
              Sign in
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  )
}

