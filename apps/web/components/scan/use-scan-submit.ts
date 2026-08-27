/**
 * Starting a scan, in one place.
 *
 * There are two scan forms — the hero's and the standard one — and they look
 * nothing alike. What must never differ is what happens when you press Enter:
 * the same validation the API route re-runs, the same error sentence from the
 * server, the same destination. Keeping that here means the forms are purely
 * presentational and cannot drift into two behaviours.
 *
 * ## Auth gate
 *
 * The hero's product rule is "free to scan, an account opens the findings" —
 * a signed-out visitor pastes a URL, hits Scan, and is bounced to /login.
 * After sign-in they return to the page with the URL they typed already in
 * the box, picked up from sessionStorage. The standard form is reached only
 * from inside the signed-in app, so it does not gate.
 *
 * ## SSR safety
 *
 * `useConvexAuth` only works inside a ConvexAuthNextjsProvider that has
 * hydrated on the client. During SSR there is no provider, so calling the
 * hook would throw. We report `authLoading: true` until the client mounts,
 * which makes the gate a no-op (and the API route is itself the source of
 * truth on whether a scan needs an account).
 */

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useConvexAuth } from '@convex-dev/auth/react'
import { normalizeScanTarget } from '@/lib/url.ts'

/** What the hero form stashes in sessionStorage while the user goes to sign in. */
const PENDING_URL_KEY = 'darvin:pending-scan-url'

export interface ScanSubmit {
  pending: boolean
  error: string | null
  clearError: () => void
  /** Resolves false when the scan did not start, so the caller can refocus. */
  submit: (value: string) => Promise<boolean>
  /** True while the auth state is still being resolved. */
  authLoading: boolean
}

export function useScanSubmit(): ScanSubmit {
  const router = useRouter()
  const { isLoading: rawLoading, isAuthenticated } = useConvexAuth()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  /*
   * Until the component has mounted on the client, the Convex auth context is
   * not present. Pretend we're still loading so the gate below is a no-op:
   * the server-rendered HTML matches the first client render and the
   * provider's hooks are never called with no provider in scope.
   */
  useEffect(() => {
    setHydrated(true)
  }, [])

  const authLoading = !hydrated || rawLoading

  /*
   * After a sign-in round-trip the user lands back here. If they came from the
   * hero (the only place we stash one), pick the URL up and refill the input.
   * The storage call sits in an effect so it runs on mount, not on every
   * render of every component that imports this hook.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isAuthenticated) {
      const pending = window.sessionStorage.getItem(PENDING_URL_KEY)
      if (pending) {
        window.sessionStorage.removeItem(PENDING_URL_KEY)
        const input = document.querySelector<HTMLInputElement>('input[name="url"]')
        if (input) {
          input.value = pending
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.focus()
        }
      }
    }
  }, [isAuthenticated])

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

    /*
     * The gate sits AFTER validation on purpose: a URL the scanner cannot read
     * is no reason to send somebody through sign-in. They typed something,
     * that something is not scan-worthy, and bouncing them to /login now would
     * also bounce them back to a still-broken URL after.
     */
    if (!authLoading && !isAuthenticated) {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(PENDING_URL_KEY, target.url)
      }
      router.push('/login?next=/')
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

  return { pending, error, clearError: () => setError(null), submit, authLoading }
}
