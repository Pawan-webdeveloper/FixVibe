import Link from 'next/link'
import { BrandMark } from '@/components/marketing/brand-mark.tsx'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'

export const metadata = { title: 'Not found' }

/**
 * The catch-all 404.
 *
 * Without this file Next serves its own, which is the one screen in the
 * product that would not be in the product's typeface — and a page that looks
 * like a different site is exactly the wrong thing to show somebody who
 * already suspects they are somewhere they should not be.
 *
 * It carries its own shell rather than a layout's, because a not-found at the
 * app root is rendered outside every route group.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-6 py-10">
      <Link href="/" className="flex items-center gap-2" aria-label="ScanlyFix — home">
        <BrandMark size={16} track="var(--line)" arc="var(--ink)" />
        <span className="text-[15px] font-semibold tracking-tight">scanlyfix</span>
      </Link>

      <div className="mt-20">
        <LabeledRule label="404" trailing="no such page" />
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          There is nothing at this address
        </h1>
        <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-muted text-pretty">
          The link may be mistyped, or the page may have been removed. Nothing was scanned and
          nothing was recorded.
        </p>

        <Link
          href="/"
          className="label mt-8 inline-flex h-11 items-center border border-ink bg-ink px-6 text-canvas
                     transition-colors hover:bg-transparent hover:text-ink"
        >
          Scan a site
        </Link>
      </div>
    </div>
  )
}
