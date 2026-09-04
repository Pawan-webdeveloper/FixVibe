'use client'

import { useEffect, useMemo, useState } from 'react'
import type { OnboardingStepKey } from './onboarding-stepper.tsx'
import {
  REVEAL_STAGGER_MS,
  buildRows,
  overallVerdict,
  type CheckStatus,
  type OnboardingCheckPayload,
  type OverallVerdict,
} from './onboarding-checks-logic.ts'

/**
 * Steps 2 and 3 — probe the URL, then render the scorecard.
 *
 * The four checks (uptime / SSL / domain / PSI) come back in a single
 * JSON payload from /api/onboarding/check; the server fans them out
 * in parallel and the client only sees one response. The "animate in"
 * feel comes from the way each row transitions pending → done with a
 * short delay between them — the eye reads it as four separate
 * completions even though the wire carried one.
 *
 * Why one fetch, not four:
 *   - SSRF / CORS / PSI-key concerns all sit on the server, so the
 *     client cannot probe directly. Four fetches would be four
 *     round trips on the slowest path (PSI), each re-authenticating.
 *   - The user wants the scorecard; if one check takes 8 seconds the
 *     whole UI is gated on it anyway, and showing the rows populate
 *     one at a time is what the design wants regardless.
 *
 * Tone of each row (green / amber / red) and the scorecard verdict
 * live in `onboarding-checks-logic.ts` so they are unit-tested
 * without dragging JSX into the node test environment.
 *
 * The scorecard aggregates the four tones into an overall verdict:
 * any red → "needs attention", any amber → "watch the amber", all
 * green → "everything is green". The overall verdict does NOT block
 * step 4 — the user is the one who decides whether to keep going.
 */

export type { OnboardingCheckPayload, CheckStatus, OverallVerdict } from './onboarding-checks-logic.ts'

export interface OnboardingStepChecksProps {
  url: string
  hostname: string
  /** Called when the user accepts the scorecard and wants to set up monitors. */
  onContinue: () => void
  /** Called when the user wants to pick a different site (sends them back to step 1). */
  onRetarget: () => void
  /** Stepper key — the stepper in the parent is given this so it can highlight the right dot. */
  onStepChange?: (key: OnboardingStepKey) => void
}

export function OnboardingStepChecks({
  url,
  hostname,
  onContinue,
  onRetarget,
  onStepChange,
}: OnboardingStepChecksProps) {
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<OnboardingCheckPayload | null>(null)
  // When true, the row is in its "pending" frame and counts down to its
  // "done" reveal. Each row gets its own boolean so the staggered reveal
  // does not depend on the others.
  const [pending, setPending] = useState({ uptime: true, ssl: true, domain: true, vitals: true })

  // Tell the parent which step is active so the stepper highlights it.
  // During the probe we are on `checks`; once the scorecard is on screen
  // we are on `score`. The parent uses the same key for both labels,
  // so this is purely cosmetic — but the active row is what the stepper
  // mirrors, and "checks" is the more accurate label while the probe is
  // still in flight.
  useEffect(() => {
    onStepChange?.(payload === null ? 'checks' : 'score')
  }, [payload, onStepChange])

  useEffect(() => {
    let cancelled = false
    setPending({ uptime: true, ssl: true, domain: true, vitals: true })
    setPayload(null)
    setError(null)

    async function run() {
      try {
        const response = await fetch('/api/onboarding/check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url }),
        })
        if (cancelled) return
        if (!response.ok) {
          const detail: unknown = await response.json().catch(() => null)
          const reason =
            detail && typeof detail === 'object' && 'error' in detail && typeof detail.error === 'string'
              ? detail.error
              : `The probe could not run (HTTP ${response.status}).`
          setError(reason)
          setPending({ uptime: false, ssl: false, domain: false, vitals: false })
          return
        }
        const body = (await response.json()) as OnboardingCheckPayload
        if (cancelled) return
        setPayload(body)
        // Stagger the "done" flip per row. The fastest check (uptime)
        // lands first, then SSL/domain, then PSI. The result was on the
        // wire already — we are only orchestrating the visual reveal so
        // the rows feel like four separate completions.
        const stagger: Array<keyof typeof pending> = ['uptime', 'ssl', 'domain', 'vitals']
        for (const [i, key] of stagger.entries()) {
          setTimeout(() => {
            if (cancelled) return
            setPending((current) => ({ ...current, [key]: false }))
          }, REVEAL_STAGGER_MS[i])
        }
      } catch {
        if (cancelled) return
        setError('Could not reach the probe. Check your connection and try again.')
        setPending({ uptime: false, ssl: false, domain: false, vitals: false })
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [url])

  const rows = useMemo(() => buildRows(payload, pending), [payload, pending])
  const verdict = useMemo(() => overallVerdict(rows), [rows])
  const isProbing = rows.some((row) => row.status === 'pending') && error === null

  return (
    <div className="mt-6 flex flex-col gap-6">
      <p className="text-[14px] text-c-body">
        Probing <span className="font-medium text-c-ink">{hostname}</span>…
      </p>

      <ul className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <CheckRow key={row.key} row={row} index={index} />
        ))}
      </ul>

      {error !== null && (
        <div className="rounded-xl border border-sev-high/40 bg-sev-high/5 p-4 text-[13px] text-sev-high">
          {error}
          <button
            type="button"
            onClick={onRetarget}
            className="ml-3 rounded-full border border-sev-high/40 px-3 py-1 text-[12px] font-medium hover:bg-sev-high/10"
          >
            Pick a different site
          </button>
        </div>
      )}

      {payload !== null && error === null && (
        <Scorecard verdict={verdict} onContinue={onContinue} onRetarget={onRetarget} isProbing={isProbing} />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Row + scorecard                                                            */
/* -------------------------------------------------------------------------- */

function CheckRow({
  row,
  index,
}: {
  row: ReturnType<typeof buildRows>[number]
  index: number
}) {
  const isPending = row.status === 'pending'
  return (
    <li
      className={`flex items-center justify-between gap-4 rounded-xl border px-5 py-4 transition-all duration-300 ${rowClass(row.status)}`}
      style={{ transitionDelay: `${index * 60}ms` }}
    >
      <span className="flex items-center gap-3">
        <StatusDot status={row.status} />
        <span className="text-[14px] font-medium">{row.label}</span>
      </span>
      <span className="flex items-baseline gap-3 text-right">
        <span className={`text-[14px] ${isPending ? 'text-c-muted' : 'text-c-ink'}`}>
          {row.headline}
        </span>
        {row.detail !== null && !isPending && (
          <span className="hidden text-[12px] text-c-muted sm:inline">{row.detail}</span>
        )}
      </span>
    </li>
  )
}

function Scorecard({
  verdict,
  onContinue,
  onRetarget,
  isProbing,
}: {
  verdict: OverallVerdict
  onContinue: () => void
  onRetarget: () => void
  isProbing: boolean
}) {
  return (
    <div className="rounded-2xl border border-c-line/60 bg-c-card p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-c-muted">Scorecard</p>
      <h2 className="mt-2 text-[24px] font-light leading-tight tracking-[-0.02em] text-c-ink">
        {verdict.headline}
      </h2>
      <p className="mt-2 text-[14px] leading-relaxed text-c-body text-pretty">{verdict.body}</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onContinue}
          disabled={isProbing}
          className="rounded-full bg-c-ink px-6 py-2.5 text-[14px] font-medium text-c-brand-ink
                     transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {isProbing ? 'Still probing…' : 'Monitor this site every minute'}
        </button>
        <button
          type="button"
          onClick={onRetarget}
          className="rounded-full border border-c-line px-5 py-2.5 text-[13px] font-medium text-c-body
                     transition-colors hover:bg-c-soft"
        >
          Pick a different site
        </button>
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: CheckStatus }) {
  if (status === 'pending') {
    return (
      <span
        aria-hidden="true"
        className="grid h-5 w-5 place-items-center rounded-full border border-c-line bg-c-bg"
      >
        <span className="block h-2 w-2 animate-pulse rounded-full bg-c-muted" />
      </span>
    )
  }
  if (status === 'green') {
    return (
      <span
        aria-hidden="true"
        className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-white"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
          <path d="M5 12l5 5 9-11" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }
  if (status === 'amber') {
    return (
      <span
        aria-hidden="true"
        className="grid h-5 w-5 place-items-center rounded-full bg-amber-500 text-white"
      >
        <span className="block h-1 w-2.5 rounded-sm bg-white" />
      </span>
    )
  }
  return (
    <span
      aria-hidden="true"
      className="grid h-5 w-5 place-items-center rounded-full bg-sev-high text-white"
    >
      <span className="block h-1 w-2.5 rounded-sm bg-white" />
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Tone → tailwind class                                                      */
/* -------------------------------------------------------------------------- */

function rowClass(status: CheckStatus): string {
  switch (status) {
    case 'pending':
      return 'border-c-line/60 bg-c-card'
    case 'green':
      return 'border-emerald-500/30 bg-emerald-500/5'
    case 'amber':
      return 'border-amber-500/40 bg-amber-500/5'
    case 'red':
      return 'border-sev-high/40 bg-sev-high/5'
  }
}
