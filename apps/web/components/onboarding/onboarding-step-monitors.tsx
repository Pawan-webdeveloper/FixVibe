'use client'

import { useState, useTransition } from 'react'
import {
  createOnboardingProjectAction,
  type CreateOnboardingProjectResult,
} from '@/app/(app)/onboarding/actions.ts'

/**
 * Step 4 — "We monitor all this every minute."
 *
 * Two states the wizard can be in at this step:
 *
 *   1. The action has not been called yet. Show a short paragraph
 *      restating the value (one-minute checks, four default monitors)
 *      and a single CTA. Pressing it kicks off the server action.
 *
 *   2. The action returned a project. Transition the screen to a
 *      short confirmation + a "continue" CTA that hands off to the
 *      alert step.
 *
 * Reusing createProjectWithMonitors from Phase 7.1 means the wizard
 * cannot fork from the dashboard "add domain" flow — they create the
 * exact same row and the exact same four monitors in the exact same
 * transaction. That symmetry is the whole point of the function: any
 * code that says "I created a project" can be debugged against one
 * call site, not several.
 *
 * Why a separate component for one button:
 *   - The action call is async; a useTransition gates the button so a
 *     second click during the in-flight request cannot spawn a second
 *     project.
 *   - The result state is local to this step — lifting it into the
 *     wizard would couple step 5 to step 4's promise resolution when
 *     step 5 only needs the slug.
 *
 * Re-uses the redirect variant below when the user wants to skip the
 * alert step entirely ("just take me to the project").
 */

export interface OnboardingStepMonitorsProps {
  url: string
  hostname: string
  /** Called when the project is created — wizard advances to step 5 with the slug. */
  onCreated: (result: { projectId: string; slug: string }) => void
  /** Called when the user wants to skip ahead without creating a project. */
  onSkip: () => void
}

export function OnboardingStepMonitors({ url, hostname, onCreated, onSkip }: OnboardingStepMonitorsProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleEnable() {
    setError(null)
    startTransition(async () => {
      const result: CreateOnboardingProjectResult = await createOnboardingProjectAction(url, hostname)
      if (!result.ok || !result.projectId || !result.slug) {
        setError(result.error ?? 'Could not create the project.')
        return
      }
      onCreated({ projectId: result.projectId, slug: result.slug })
    })
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="rounded-2xl border border-c-line/60 bg-c-card p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-c-muted">
          Monitoring
        </p>
        <h2 className="mt-2 text-[24px] font-light leading-tight tracking-[-0.02em] text-c-ink">
          We&apos;ll watch this every minute.
        </h2>
        <p className="mt-3 max-w-[60ch] text-[14px] leading-relaxed text-c-body text-pretty">
          For{' '}
          <span className="font-medium text-c-ink">{hostname}</span> we&apos;ll start an uptime check,
          a domain-expiry check, an SSL-expiry check, and a web-vitals (PageSpeed Insights) check on a
          one-minute cadence. Each check is independent, so a slow site won&apos;t delay a cert
          warning and vice versa.
        </p>

        <ul className="mt-5 grid gap-2 text-[13px] text-c-body sm:grid-cols-2">
          <Bullet>Uptime probe every 60s</Bullet>
          <Bullet>SSL expiry alert at 14 / 7 / 1 days</Bullet>
          <Bullet>Domain expiry alert at 30 / 7 days</Bullet>
          <Bullet>Web vitals every 5 minutes</Bullet>
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleEnable}
            disabled={pending}
            className="rounded-full bg-c-ink px-6 py-2.5 text-[14px] font-medium text-c-brand-ink
                       transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? 'Creating…' : 'Set up monitors for this site'}
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={pending}
            className="rounded-full border border-c-line px-5 py-2.5 text-[13px] font-medium text-c-body
                       transition-colors hover:bg-c-soft disabled:opacity-60"
          >
            Skip to dashboard
          </button>
        </div>

        {error !== null && (
          <p role="alert" aria-live="polite" className="mt-3 text-[13px] text-sev-high">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden="true" className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-c-ink/40" />
      <span>{children}</span>
    </li>
  )
}
