/**
 * Starting a scan, in one place.
 *
 * There are two scan forms — the hero's and the standard one — and they look
 * nothing alike. What must never differ is what happens when you press Enter:
 * the same validation the API route re-runs, the same error sentence from the
 * server, the same destination. Keeping that here means the forms are purely
 * presentational and cannot drift into two behaviours.
 *
 * ## Why the hook owns the input's value
 *
 * The forms used to hold their own `useState` for the text, which made the
 * hook unable to change it. Restoring a URL after sign-in therefore had to
 * reach for the DOM — assign `input.value` and dispatch an `input` event — and
 * that does not work against a React controlled input. React installs its own
 * setter on the node and updates its change tracker from it, so by the time
 * the dispatched event is compared against the tracker the two already agree,
 * React concludes nothing changed, and `onChange` never fires. The box showed
 * the URL while the state behind it stayed empty, so pressing Scan validated
 * the empty string.
 *
 * Owning the value here removes the class of bug rather than the instance:
 * there is one source of truth, and restoring is an ordinary setState.
 *
 * ## Auth gate
 *
 * A signed-out visitor who presses Scan is sent to /login, with the URL they
 * typed kept in sessionStorage so they come back to a filled box. Only the
 * form that asked for `restore` picks it up — otherwise both forms on the
 * landing page would race for the same key and fight over focus.
 *
 * ## SSR safety
 *
 * `useConvexAuth` needs a provider that has hydrated on the client. Until this
 * has mounted we report `authLoading: true`, which makes the gate a no-op and
 * keeps the server-rendered HTML identical to the first client render.
 */

'use client'

import { useEffect, useState, type RefObject } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useConvexAuth } from '@convex-dev/auth/react'
import { normalizeScanTarget } from '@/lib/url.ts'
import {
  sessionStore,
  shouldGateScan,
  stashPendingUrl,
  takePendingUrl,
} from './pending-scan-url.ts'

export interface ScanSubmitOptions {
  /**
   * Whether this form should pick up a URL left behind by a sign-in trip.
   *
   * The hero opts in; the final CTA does not. Both stash on the way out, but a
   * visitor returning from /login lands at the top of the page, so the hero is
   * the box they are looking at.
   */
  restore?: boolean
  /** Focused after a restore, so the visitor can just press Enter. */
  inputRef?: RefObject<HTMLInputElement | null>
}

export interface ScanSubmit {
  /** The input's text. The hook owns it; the form only renders it. */
  value: string
  /** Sets the text and clears any error, because typing is a correction. */
  setValue: (next: string) => void
  pending: boolean
  error: string | null
  /** Resolves false when the scan did not start, so the caller can refocus. */
  submit: () => Promise<boolean>
  /** True while the auth state is still being resolved. */
  authLoading: boolean
}

export function useScanSubmit(options: ScanSubmitOptions = {}): ScanSubmit {
  const { restore = false, inputRef } = options
  const router = useRouter()
  const pathname = usePathname()
  const { isLoading: rawLoading, isAuthenticated } = useConvexAuth()
  const [value, setValueState] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  /*
   * Until this has mounted on the client there is no Convex auth context.
   * Reporting "still loading" keeps the gate closed for that first render, so
   * the server's HTML and the client's first pass agree.
   */
  useEffect(() => {
    setHydrated(true)
  }, [])

  const authLoading = !hydrated || rawLoading

  /*
   * The return leg of a sign-in. Runs once the visitor is known to be signed
   * in, because that is the only case a stashed URL was waiting for — reading
   * it earlier would consume it before the trip completed, and reading it for
   * a visitor who never signed in would hand them somebody else's leftover.
   */
  useEffect(() => {
    if (!restore || !isAuthenticated) return
    const url = takePendingUrl(sessionStore())
    if (url === null) return
    setValueState(url)
    setError(null)
    inputRef?.current?.focus()
  }, [restore, isAuthenticated, inputRef])

  /*
   * A submission that went through the Server Action — the no-JavaScript path,
   * or a click that landed before hydration — cannot render its own rejection,
   * so it comes back as ?scan_error and is picked up here.
   *
   * Read from window.location rather than useSearchParams on purpose: this page
   * is statically prerendered, and useSearchParams would demand a Suspense
   * boundary or opt the whole landing page into dynamic rendering to serve the
   * few visitors who arrive without JavaScript.
   */
  useEffect(() => {
    if (!restore || typeof window === 'undefined') return

    const params = new URLSearchParams(window.location.search)
    const failed = params.get('scan_error')
    if (failed === null || failed === '') return

    setError(failed)

    // Stripped from the address bar so a reload does not raise an error the
    // visitor has already read and acted on.
    params.delete('scan_error')
    const query = params.toString()
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (query ? `?${query}` : '') + window.location.hash,
    )
  }, [restore])

  function setValue(next: string) {
    setValueState(next)
    // Typing is how somebody answers a rejection, so the rejection goes as
    // soon as they start. Guarded so an untouched error is not re-set to null
    // on every keystroke.
    setError((current) => (current === null ? current : null))
  }

  async function submit(): Promise<boolean> {
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
    if (shouldGateScan({ authLoading, isAuthenticated })) {
      stashPendingUrl(sessionStore(), target.url)
      // Come back to the page they left, not to a hardcoded one.
      const next = pathname || '/'
      router.push(`/login?next=${encodeURIComponent(next)}`)
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

      /*
       * 401 is the server insisting on an account — the backstop behind the
       * client gate above, reached when the client believed it was signed in
       * but the cookie says otherwise (a stale token, an expired session). It
       * is a redirect, not an error: keep the URL and send them to sign in, the
       * same as the gate does, rather than showing "not authorized" for
       * something they can simply fix by signing in.
       */
      if (response.status === 401) {
        stashPendingUrl(sessionStore(), target.url)
        const next = pathname || '/'
        router.push(`/login?next=${encodeURIComponent(next)}`)
        return false
      }

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

  return { value, setValue, pending, error, submit, authLoading }
}
