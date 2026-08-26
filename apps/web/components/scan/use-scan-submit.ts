'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { normalizeScanTarget } from '@/lib/url.ts'

/**
 * Starting a scan, in one place.
 *
 * There are two scan forms — the hero's and the standard one — and they look
 * nothing alike. What must never differ is what happens when you press Enter:
 * the same validation the API route re-runs, the same error sentence from the
 * server, the same destination. Keeping that here means the forms are purely
 * presentational and cannot drift into two behaviours.
 */

export interface ScanSubmit {
  pending: boolean
  error: string | null
  clearError: () => void
  /** Resolves false when the scan did not start, so the caller can refocus. */
  submit: (value: string) => Promise<boolean>
}

export function useScanSubmit(): ScanSubmit {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(value: string): Promise<boolean> {
    if (pending) return false

    // Client-side only so a typo comes back instantly instead of after a round
    // trip; the API route runs this exact function again, because nothing
    // arriving over the wire is trusted.
    const target = normalizeScanTarget(value)
    if (!target.ok) {
      setError(target.reason)
      return false
    }

    setError(null)
    setPending(true)

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: target.url }),
      })

      if (!response.ok) {
        // The server owns the real verdict — an SSRF-blocked target, a site
        // that would not respond, a rate limit. Surface its sentence, not a
        // status code.
        const detail: unknown = await response.json().catch(() => null)
        const reason =
          detail && typeof detail === 'object' && 'error' in detail && typeof detail.error === 'string'
            ? detail.error
            : `The scan could not be started (HTTP ${response.status}).`
        setError(reason)
        setPending(false)
        return false
      }

      const { scanId } = (await response.json()) as { scanId: string }
      router.push(`/scan/${scanId}`)
      // Deliberately left pending: the route change is in flight, and
      // re-enabling the button would invite a second scan on the way out.
      return true
    } catch {
      setError('Could not reach the scanner. Check your connection and try again.')
      setPending(false)
      return false
    }
  }

  return { pending, error, clearError: () => setError(null), submit }
}
