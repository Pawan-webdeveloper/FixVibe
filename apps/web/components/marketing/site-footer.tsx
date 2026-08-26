import Link from 'next/link'
import { ENGINE_VERSION } from '@darvin/checks'
import { TOTAL_CHECKS } from '@/lib/pillars.ts'

/**
 * The footer, ending on the promise the whole page is built around.
 *
 * The engine version and check count are printed because they are the two
 * facts that make a report reproducible — and printing them where a reader can
 * see them is the cheapest possible proof that the numbers on this page come
 * from the code rather than from a copywriter.
 */

const LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/#checks', label: 'Checks' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
  { href: '/login', label: 'Sign in' },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <p className="max-w-[52ch] text-sm text-muted text-pretty">
            Darvin reads only what a browser would read. It never logs in, submits forms, or
            attempts anything a site owner has not already made public.
          </p>

          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {LINKS.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="text-sm text-muted transition-colors hover:text-ink"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <p className="mt-10 border-t border-line pt-6 font-mono text-xs text-muted">
          engine {ENGINE_VERSION} · {TOTAL_CHECKS} checks
        </p>
      </div>
    </footer>
  )
}
