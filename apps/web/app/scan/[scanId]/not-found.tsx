import Link from 'next/link'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'

/**
 * Also the answer for a scan that exists but belongs to someone else.
 * getScanForViewer returns null in both cases on purpose: confirming that an
 * id is real, to somebody not entitled to read it, is itself a disclosure —
 * so the wording below has to cover both without hinting at which one it is.
 */
export default function ScanNotFound() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24">
      <LabeledRule label="404" trailing="report unavailable" />
      <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em]">This scan is not available</h1>
      <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-muted text-pretty">
        The link may be mistyped, or the scan may belong to an account you are not signed in to.
      </p>

      <Link
        href="/"
        className="label mt-8 inline-flex h-11 items-center border border-ink bg-ink px-6 text-canvas
                   transition-colors hover:bg-transparent hover:text-ink"
      >
        Scan a site
      </Link>
    </div>
  )
}
