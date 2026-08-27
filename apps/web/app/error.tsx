'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { BrandMark } from '@/components/marketing/brand-mark.tsx'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'

/**
 * The catch-all 500, for the same reason not-found.tsx exists: without it Next
 * serves its own screen, and a page in a different typeface tells somebody who
 * just hit an error that the whole site is broken rather than one request.
 *
 * Two things are deliberately absent.
 *
 * `error.message` is not rendered. In production Next already replaces it with
 * a generic string, but the digest is the part that is actually useful and the
 * message is the part that leaks table names and query fragments when the
 * replacement does not happen. Showing the digest gives support something to
 * search the logs for; showing the message gives an attacker a schema.
 *
 * There is no "contact us" link, because reset() is the action that has a real
 * chance of working — most 500s here are a database connection that has since
 * come back — and offering two actions makes the wrong one look equal.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The server logs its own errors; this is the client half, and without it a
    // hydration or render error in the browser is seen by nobody.
    console.error('[error boundary]', error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-6 py-10">
      <Link href="/" className="flex items-center gap-2" aria-label="Darvin — home">
        <BrandMark size={16} track="var(--line)" arc="var(--ink)" />
        <span className="text-[15px] font-semibold tracking-tight">darvin</span>
      </Link>

      <div className="mt-20">
        <LabeledRule label="500" trailing="something broke" />
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          This page did not load
        </h1>
        <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-muted text-pretty">
          The fault is on our side, not with the site you were scanning. Nothing you had in progress
          was lost — trying again is usually enough.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
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

        {/* The one identifier that ties this screen to a line in the logs. */}
        {error.digest && (
          <p className="label mt-10 text-muted">
            Reference <span className="text-ink">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  )
}
