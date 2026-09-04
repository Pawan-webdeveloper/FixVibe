'use client'

/*
 * "Last updated X ago" + a manual Refresh button.
 *
 * Server component renders the timestamp; this thin client wrapper
 * gives the user a button to ask Next.js to re-render the page tree.
 *
 * `router.refresh()` re-fetches server-component data without a hard
 * navigation — the in-flight state (any open form, scroll position)
 * survives. The page is wrapped in `revalidate = 60` so this is a
 * "skip the cache" knob, not the default refresh path.
 */

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

interface LastUpdatedIndicatorProps {
  /** Pre-formatted "X ago" string from the server. */
  label: string
  /** Absolute ISO timestamp — the client renders the same label until
   *  a refresh completes; this is for the title attribute tooltip. */
  iso: string
}

export function LastUpdatedIndicator({ label, iso }: LastUpdatedIndicatorProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tick, setTick] = useState(0)

  function refresh() {
    startTransition(async () => {
      router.refresh()
      // Re-render the relative-time label locally so the user sees
      // something happen even if the network round trip is fast.
      setTick((t) => t + 1)
    })
  }

  return (
    <div
      data-testid="last-updated-indicator"
      className="mt-3 flex items-center justify-between text-xs text-gray-400"
    >
      <span title={iso}>
        Last updated {label}
        {tick > 0 ? null : null /* tick reserved for future local-rerender */}
      </span>
      <button
        type="button"
        onClick={refresh}
        disabled={isPending}
        aria-label="Refresh status"
        className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 disabled:opacity-50"
      >
        {isPending ? 'Refreshing…' : '↻ Refresh'}
      </button>
    </div>
  )
}
