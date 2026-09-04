'use client'

import { useEffect, useState } from 'react'

/**
 * Step 6 — "Share the status page."
 *
 * The status page is the wizard's last gift. It is the URL the user
 * can paste into their team's incident channel, into a customer
 * announcement, into a status-page directory. Making it easy to copy
 * is the whole UX; nothing on this step is interactive except the
 * copy button.
 *
 * The link is built from the public app origin and the project's
 * slug. window.location.origin is read at mount, not from the
 * server, because the page is also rendered into preview / staging
 * environments where NEXT_PUBLIC_APP_URL is set per-environment.
 * Falling back to that env var keeps a render that happens before
 * hydration (and a server-side error boundary) honest.
 *
 * Why a manual copy button instead of navigator.clipboard on mount:
 *   - It is presumptuous. A user who has not asked to share a link
 *     should not have one on their clipboard.
 *   - navigator.clipboard requires a user gesture the first time on
 *     most browsers, and "I opened a page" does not count.
 */

export interface OnboardingStepStatusProps {
  slug: string
  projectName: string
  projectUrl: string
  /** Called when the user wants to jump to the project view. */
  onOpenProject: () => void
  /** Called when the user wants to return to the dashboard. */
  onDashboard: () => void
  /** Project id for the "open the project" CTA. */
  projectId: string
}

type CopyState = 'idle' | 'copied' | 'error'

export function OnboardingStepStatus({
  slug,
  projectName,
  projectUrl,
  projectId,
  onOpenProject,
  onDashboard,
}: OnboardingStepStatusProps) {
  const [origin, setOrigin] = useState<string>('')
  const [copyState, setCopyState] = useState<CopyState>('idle')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin)
    } else {
      // SSR fallback. The button is not interactive until hydration
      // completes, so this only matters for the initial render — but
      // it must be a real URL rather than the literal string "undefined".
      const envOrigin = (process.env['NEXT_PUBLIC_APP_URL'] ?? '').replace(/\/$/, '')
      setOrigin(envOrigin || '')
    }
  }, [])

  const statusUrl = origin && slug ? `${origin}/status/${slug}` : ''

  async function handleCopy() {
    if (!statusUrl) return
    try {
      await navigator.clipboard.writeText(statusUrl)
      setCopyState('copied')
      // Brief feedback window, then revert so a second copy does not
      // silently no-op while the button still says "Copied".
      setTimeout(() => setCopyState('idle'), 1800)
    } catch {
      setCopyState('error')
      setTimeout(() => setCopyState('idle'), 2400)
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="rounded-2xl border border-c-line/60 bg-c-card p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-c-muted">
          Status page
        </p>
        <h2 className="mt-2 text-[24px] font-light leading-tight tracking-[-0.02em] text-c-ink">
          {projectName} is live.
        </h2>
        <p className="mt-3 max-w-[60ch] text-[14px] leading-relaxed text-c-body text-pretty">
          This is the link you paste into your team&apos;s incident channel or your customer
          announcement when something breaks. It updates every minute — no login required.
        </p>

        <div className="mt-5 flex flex-col gap-3 rounded-xl border border-c-line bg-c-bg p-4 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-c-ink">
            {statusUrl || `/status/${slug}`}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!statusUrl}
            aria-live="polite"
            className={`shrink-0 rounded-full px-5 py-2 text-[13px] font-medium transition-colors ${
              copyState === 'copied'
                ? 'bg-emerald-500 text-white'
                : copyState === 'error'
                  ? 'bg-sev-high text-white'
                  : 'bg-c-ink text-c-brand-ink hover:opacity-90 disabled:opacity-60'
            }`}
          >
            {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy link'}
          </button>
        </div>
        <p className="mt-2 text-[12px] text-c-muted">
          Tracking <span className="font-mono">{projectUrl}</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={statusUrl || `/status/${slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-c-line px-5 py-2.5 text-[13px] font-medium text-c-body
                     transition-colors hover:bg-c-soft"
        >
          Open status page ↗
        </a>
        <button
          type="button"
          onClick={onOpenProject}
          data-project-id={projectId}
          className="rounded-full bg-c-ink px-6 py-2.5 text-[14px] font-medium text-c-brand-ink
                     transition-opacity hover:opacity-90"
        >
          Open my project
        </button>
        <button
          type="button"
          onClick={onDashboard}
          className="ml-auto text-[13px] text-c-muted hover:text-c-ink"
        >
          Back to dashboard
        </button>
      </div>
    </div>
  )
}
