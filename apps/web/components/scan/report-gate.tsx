/**
 * What a reader is shown in place of the findings that were withheld.
 *
 * Nothing here blurs anything, because there is nothing to blur — the server
 * never sent the withheld text, so there is no rectangle to smear. A blur
 * would also be a bluff, and the first reader to open dev tools would find out.
 *
 * What is shown instead is the count and the severities. "7 more findings, 2 of
 * them high" is a specific thing to obtain; a frosted panel is a guess, and it
 * reads as a trick rather than as an offer.
 *
 * Two gates, in a deliberate order. A signed-out reader is asked for an
 * account, never for money: they have not yet seen a single finding opened, so
 * a price is being quoted for something they have no way to value. Only a
 * reader who has read the worst few in full is shown Pro.
 */

import Link from 'next/link'
import type { Severity } from '@scanlyfix/checks'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'

const SEVERITY_STYLE: Record<Severity, string> = {
  critical: 'text-critical',
  high: 'text-high',
  medium: 'text-medium',
  low: 'text-low',
  info: 'text-info',
}

const ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']

const BUTTON =
  'label inline-flex h-11 items-center gap-2 px-6 transition-colors duration-150'

function LockIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect x="5" y="11" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

export function ReportGate({
  lockedCount,
  lockedSeverities,
  signedIn,
  /** Where to return to after signing in — this report, not the dashboard. */
  returnTo,
}: {
  lockedCount: number
  lockedSeverities: Severity[]
  signedIn: boolean
  returnTo: string
}) {
  if (lockedCount === 0) return null

  const counts = ORDER.map((severity) => ({
    severity,
    n: lockedSeverities.filter((s) => s === severity).length,
  })).filter((entry) => entry.n > 0)

  return (
    <section className="mt-10 border border-line bg-surface px-6 py-6">
      <LabeledRule
        as="h2"
        label={signedIn ? 'Withheld' : 'Locked'}
        trailing={`${lockedCount} finding${lockedCount === 1 ? '' : 's'}`}
      />

      <p className="mt-5 flex items-center gap-2 text-lg font-medium text-balance">
        {signedIn && <LockIcon size={18} className="text-accent" />}
        {signedIn ? 'The rest of this report is part of Pro' : 'Sign in to read this report'}
      </p>

      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1">
        {counts.map(({ severity, n }) => (
          <li key={severity} className="tabular-nums">
            <span className={`font-semibold ${SEVERITY_STYLE[severity]}`}>{n}</span>{' '}
            <span className="label text-muted">{severity}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted text-pretty">
        {signedIn
          ? 'Their titles and severities are listed above. Pro unlocks the detail, the evidence behind each one, and the single prompt that fixes them all.'
          : 'Every finding is named and rated above — nothing is hidden about how bad this is. An account opens the worst of them in full: the evidence the engine observed, and the fix prompt for it. Scanning stays free either way.'}
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        {signedIn ? (
          <>
            <Link href="/pricing" className={`${BUTTON} border border-ink bg-ink text-canvas hover:bg-transparent hover:text-ink`}>
              <LockIcon />
              See Pro
            </Link>
          </>
        ) : (
          <>
            <Link
              href={`/login?next=${encodeURIComponent(returnTo)}`}
              className={`${BUTTON} border border-ink bg-ink text-canvas hover:bg-transparent hover:text-ink`}
            >
              Sign in — free
            </Link>
            <Link href="/pricing" className={`${BUTTON} border border-line hover:bg-canvas`}>
              What Pro adds
            </Link>
          </>
        )}
      </div>
    </section>
  )
}
