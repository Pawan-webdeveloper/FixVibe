import Link from 'next/link'
import { LogoBadge } from '@/components/brand/logo.tsx'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'

export const metadata = { title: 'Not found' }

/**
 * 404 inside the marketing layout — the header and footer are already mounted,
 * so this only needs the content area. A visitor who hits a bad path on the
 * public site should see the same shell they expected, not a bare page.
 */
export default function MarketingNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24">
      <LabeledRule label="404" trailing="no such page" />
      <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
        There is nothing at this address
      </h1>
      <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-muted text-pretty">
        The link may be mistyped, or the page may have been removed.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/"
          className="label inline-flex h-11 items-center border border-ink bg-ink px-6 text-canvas
                     transition-colors hover:bg-transparent hover:text-ink"
        >
          Scan a site
        </Link>
        <Link
          href="/pricing"
          className="label inline-flex h-11 items-center border border-line px-6 text-ink
                     transition-colors hover:border-ink"
        >
          Pricing
        </Link>
      </div>
    </div>
  )
}
