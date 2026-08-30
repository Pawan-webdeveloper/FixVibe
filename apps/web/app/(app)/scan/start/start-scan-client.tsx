'use client'

/**
 * The page a signed-in visitor lands on after they came to scan a site but
 * were bounced to /login to authenticate.
 *
 * The URL the visitor typed is in sessionStorage — `useScanSubmit` stashed
 * it on the way out — and the only thing this page does is run that scan
 * and follow the redirect to /scan/<id>. If the URL is missing, or the
 * scan refuses to start, it sends the visitor to the dashboard instead of
 * leaving them on a page that does nothing useful.
 *
 * Why a client component: the API call is a fetch and the redirect is a
 * router.push. The (app) layout's Supabase provider is what makes the
 * session cookie available to /api/scan, so this must run after that
 * provider has mounted.
 */

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { sessionStore, takePendingUrl } from '@/components/scan/pending-scan-url.ts'
import { normalizeScanTarget } from '@/lib/url.ts'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'
import { LogoBadge } from '@/components/brand/logo.tsx'

export function StartScanClient() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function start() {
      const raw = takePendingUrl(sessionStore())
      if (raw === null) {
        // No URL carried across sign-in — most often a refresh on this page.
        // The dashboard is the honest next stop.
        router.replace('/dashboard')
        return
      }

      const target = normalizeScanTarget(raw)
      if (!target.ok) {
        setError(target.reason)
        return
      }

      try {
        const response = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: target.url }),
        })

        if (cancelled) return

        if (response.status === 401) {
          // The session cookie didn't reach the API. The (app) layout would
          // have caught this on a fresh navigation, so a 401 here means the
          // cookie was lost between the layout render and the fetch — back
          // to /login and try again.
          router.replace('/login?next=/scan/start')
          return
        }

        if (!response.ok) {
          const detail: unknown = await response.json().catch(() => null)
          const reason =
            detail && typeof detail === 'object' && 'error' in detail && typeof detail.error === 'string'
              ? detail.error
              : `The scan could not be started (HTTP ${response.status}).`
          setError(reason)
          return
        }

        const { scanId } = (await response.json()) as { scanId: string }
        router.replace(`/scan/${scanId}`)
      } catch {
        if (!cancelled) setError('Could not reach the scanner. Check your connection and try again.')
      }
    }

    void start()
    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header>
        <div className="flex items-center gap-2.5">
          <LogoBadge size={34} />
          <span className="text-xl font-semibold tracking-tight">scanlyfix</span>
        </div>
        <div className="mt-8">
          <LabeledRule label="Report" trailing="starting your scan" />
        </div>
      </header>

      <div className="mt-10 border border-line bg-surface p-6 sm:p-8">
        {error ? (
          <>
            <p role="alert" className="text-[15px] leading-relaxed text-ink text-pretty">
              ▲ {error}
            </p>
            <Link
              href="/dashboard"
              className="label mt-6 inline-flex h-11 items-center border border-ink px-6 text-ink
                         transition-colors duration-150 hover:bg-ink hover:text-canvas"
            >
              Go to projects
            </Link>
          </>
        ) : (
          <p className="text-[15px] leading-relaxed text-muted text-pretty">
            Running your scan…
          </p>
        )}
      </div>
    </div>
  )
}
