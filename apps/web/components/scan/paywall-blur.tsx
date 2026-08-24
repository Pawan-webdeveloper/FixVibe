/**
 * What a free reader is shown in place of the findings that were withheld.
 *
 * The filename is a leftover from a design that was rejected. Nothing here
 * blurs anything, because there is nothing to blur — the server never sent the
 * withheld text, so there is no rectangle to smear. A blur would also be a
 * bluff, and the first reader to open dev tools would find out.
 *
 * What is shown instead is the count and the severities. "7 more findings, 2 of
 * them high" is a specific thing to buy; a frosted panel is a guess, and it
 * reads as a trick rather than an offer.
 */

import Link from 'next/link'
import type { Severity } from '@darvin/checks'

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'text-critical',
  high: 'text-high',
  medium: 'text-medium',
  low: 'text-low',
  info: 'text-info',
}

const ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']

export function PaywallNotice({
  lockedCount,
  lockedSeverities,
  signedIn,
}: {
  lockedCount: number
  lockedSeverities: Severity[]
  signedIn: boolean
}) {
  if (lockedCount === 0) return null

  const counts = ORDER.map((severity) => ({
    severity,
    n: lockedSeverities.filter((s) => s === severity).length,
  })).filter((entry) => entry.n > 0)

  return (
    <section className="mt-8 rounded-lg border border-line bg-surface px-6 py-5">
      <h2 className="text-base font-medium">
        {lockedCount} more finding{lockedCount === 1 ? '' : 's'} on this page
      </h2>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {counts.map(({ severity, n }) => (
          <li key={severity} className="tabular-nums">
            <span className={`font-semibold ${SEVERITY_STYLE[severity]}`}>{n}</span>{' '}
            <span className="text-muted">{severity}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 max-w-[62ch] text-sm text-muted text-pretty">
        Their titles are listed above. Pro unlocks the detail, the evidence behind each one, and the
        single prompt that fixes them all.
      </p>

      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/pricing"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
        >
          See Pro
        </Link>
        {!signedIn && (
          <Link href="/login" className="rounded-md border border-line px-4 py-2 text-sm font-medium">
            Sign in
          </Link>
        )}
      </div>
    </section>
  )
}
