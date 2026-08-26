'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Waits for a queued scan and reloads when it lands.
 *
 * Backs off, and gives up. A scan that has not finished in two minutes is stuck
 * rather than slow, and a page that polls forever is a tab quietly making
 * requests for the rest of the day.
 */
const FIRST_DELAY_MS = 1500
const MAX_DELAY_MS = 5000
const GIVE_UP_MS = 120_000

export function ScanProgress({ scanId }: { scanId: string }) {
  const router = useRouter()
  const [gaveUp, setGaveUp] = useState(false)

  useEffect(() => {
    let cancelled = false
    let delay = FIRST_DELAY_MS
    const startedAt = Date.now()

    async function poll() {
      if (cancelled) return

      if (Date.now() - startedAt > GIVE_UP_MS) {
        setGaveUp(true)
        return
      }

      try {
        const response = await fetch(`/api/scan/${scanId}/status`)
        if (response.ok) {
          const { status } = (await response.json()) as { status: string }
          if (status === 'done' || status === 'failed') {
            router.refresh()
            return
          }
        }
      } catch {
        // A dropped request is not a finished scan; keep waiting.
      }

      delay = Math.min(delay * 1.4, MAX_DELAY_MS)
      setTimeout(poll, delay)
    }

    const timer = setTimeout(poll, delay)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [scanId, router])

  return (
    <p className="mt-2 text-sm text-muted" aria-live="polite">
      {gaveUp
        ? 'This is taking longer than expected. Reload to check again.'
        : 'This page updates itself when the scan finishes.'}
    </p>
  )
}
