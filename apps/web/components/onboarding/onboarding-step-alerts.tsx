'use client'

import { useState } from 'react'
import { useSupabaseClient } from '@/components/auth/supabase-context.ts'

/**
 * Step 5 — "How should we tell you when something breaks?"
 *
 * The hard truth the design calls out: a user without a verified email
 * will not receive alerts on the first incident. There is no way to
 * soften that — the deliverability rule is the deliverability rule —
 * so the UI's job is to make the gap obvious, give them a one-click
 * way to close it, and not pretend the gap is closed while they fix
 * it.
 *
 * The component splits into two blocks:
 *
 *   1. Email. If `emailVerified` is true, the block is collapsed to a
 *      one-line confirmation; the work is done. If false, the block
 *      is the page's primary CTA ("Verify email to get alerts") and
 *      pressing it triggers `supabase.auth.resend({ type: 'signup' })`.
 *      A short banner explains that the alert path will not deliver
 *      to them until the link is clicked.
 *
 *   2. Slack. Secondary link. Slack alert wiring lives in the
 *      project's settings page, so the wizard sends them there with
 *      a "you can do this later" hint. No reason to interrupt the
 *      wizard's flow with a Slack OAuth round trip.
 *
 * The "continue" CTA at the bottom is always present so the user can
 * move to step 6 even if they did not verify — they get a status
 * page, but they have not closed the alert gap. The CTA copy says
 * "Take me to my status page" rather than "Continue" so the
 * destination is in the button label.
 */

export interface OnboardingStepAlertsProps {
  email: string
  emailVerified: boolean
  /** Called when the user wants to advance to the status-page reveal. */
  onContinue: () => void
  /** Where the "Add Slack" link lands. Defaults to settings when unset. */
  slackHref?: string
}

type SendState = 'idle' | 'sending' | 'sent' | 'error'

export function OnboardingStepAlerts({
  email,
  emailVerified,
  onContinue,
  slackHref = '/settings',
}: OnboardingStepAlertsProps) {
  const supabase = useSupabaseClient()
  const [sendState, setSendState] = useState<SendState>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleResend() {
    setSendState('sending')
    setError(null)
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo:
          typeof window !== 'undefined' ? `${window.location.origin}/onboarding` : undefined,
      },
    })
    if (resendError) {
      setSendState('error')
      setError(resendError.message)
      return
    }
    setSendState('sent')
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      {!emailVerified ? (
        <EmailVerifyBlock
          email={email}
          sendState={sendState}
          error={error}
          onResend={handleResend}
        />
      ) : (
        <EmailVerifiedBlock email={email} />
      )}

      <SlackBlock slackHref={slackHref} disabled={!emailVerified} />

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onContinue}
          className="rounded-full bg-c-ink px-6 py-2.5 text-[14px] font-medium text-c-brand-ink
                     transition-opacity hover:opacity-90"
        >
          Take me to my status page
        </button>
        {!emailVerified && (
          <p className="text-[12px] text-c-muted">
            You can come back — alerts will start the moment you verify.
          </p>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                     */
/* -------------------------------------------------------------------------- */

function EmailVerifyBlock({
  email,
  sendState,
  error,
  onResend,
}: {
  email: string
  sendState: SendState
  error: string | null
  onResend: () => void
}) {
  return (
    <section
      aria-labelledby="verify-email-heading"
      className="rounded-2xl border-2 border-c-ink/20 bg-c-card p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sev-high/10 text-sev-high"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M3 8.5l9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="3" y="5" width="18" height="14" rx="2" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-sev-high">
            Verify your email to get alerts
          </p>
          <h3
            id="verify-email-heading"
            className="mt-1 text-[18px] font-semibold leading-tight tracking-[-0.01em] text-c-ink"
          >
            We can&apos;t reach you at <span className="font-mono text-[15px]">{email}</span> yet.
          </h3>
          <p className="mt-2 max-w-[58ch] text-[14px] leading-relaxed text-c-body text-pretty">
            If your site goes down right now, the alert will be sent to this address — and bounce.
            Click the button, open the link in your inbox, and alerts start working immediately.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onResend}
          disabled={sendState === 'sending' || sendState === 'sent'}
          className="rounded-full bg-c-ink px-6 py-2.5 text-[14px] font-medium text-c-brand-ink
                     transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {sendState === 'sending'
            ? 'Sending…'
            : sendState === 'sent'
              ? 'Check your inbox'
              : 'Email me the verification link'}
        </button>
        {sendState === 'sent' && (
          <p role="status" className="text-[13px] text-emerald-600">
            Sent — open <span className="font-medium">{email}</span> and click the link.
          </p>
        )}
        {error !== null && (
          <p role="alert" className="text-[13px] text-sev-high">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}

function EmailVerifiedBlock({ email }: { email: string }) {
  return (
    <section className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-500 text-white"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
          <path d="M5 12l5 5 9-11" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <p className="text-[14px] text-c-body">
        Email alerts are on for{' '}
        <span className="font-medium text-c-ink">{email}</span>. You will hear from us the moment a
        check fails.
      </p>
    </section>
  )
}

function SlackBlock({ slackHref, disabled }: { slackHref: string; disabled: boolean }) {
  return (
    <section
      className={`flex items-center justify-between gap-4 rounded-xl border border-c-line/60 bg-c-card p-4 transition-opacity ${
        disabled ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-c-soft text-c-body"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <rect x="3" y="9" width="6" height="6" rx="1.5" />
            <rect x="15" y="3" width="6" height="6" rx="1.5" />
            <rect x="15" y="15" width="6" height="6" rx="1.5" />
            <rect x="3" y="3" width="6" height="6" rx="1.5" transform="rotate(90 6 6)" />
          </svg>
        </span>
        <div>
          <p className="text-[14px] font-medium text-c-ink">Add Slack</p>
          <p className="text-[12px] text-c-muted">
            {disabled
              ? 'Verify email first — Slack will not be useful on its own.'
              : 'Pipe alerts into a channel — you can do this now or later.'}
          </p>
        </div>
      </div>
      <a
        href={slackHref}
        className={`rounded-full border px-4 py-1.5 text-[13px] font-medium transition-colors ${
          disabled
            ? 'pointer-events-none border-c-line text-c-muted'
            : 'border-c-line text-c-body hover:bg-c-soft'
        }`}
      >
        Add Slack
      </a>
    </section>
  )
}
