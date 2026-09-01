'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { LogoBadge } from '@/components/brand/logo.tsx'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'

/**
 * 500 inside the marketing layout. The header and footer are already mounted,
 * so this only needs the content area. reset() is offered as the primary
 * action because most transient errors resolve on retry.
 */
export default function MarketingError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[marketing error boundary]', error)
  }, [error])

  return (
    <div className="mx-auto max-w-2xl px-6 py-24">
      <LabeledRule label="500" trailing="something broke" />
      <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
        This page did not load
      </h1>
      <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-muted text-pretty">
        The fault is on our side. Trying again is usually enough.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="label inline-flex h-11 items-center border border-ink bg-ink px-6 text-canvas
                     transition-colors hover:bg-transparent hover:text-ink"
        >
          Try again
        </button>
        <Link
          href="/"
          className="label inline-flex h-11 items-center border border-line px-6 text-ink
                     transition-colors hover:border-ink"
        >
          Start over
        </Link>
      </div>

      {error.digest && (
        <p className="label mt-10 text-muted">
          Reference <span className="text-ink">{error.digest}</span>
        </p>
      )}
    </div>
  )
}
