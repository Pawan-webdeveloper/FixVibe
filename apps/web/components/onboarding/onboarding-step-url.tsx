'use client'

import { useId, useState } from 'react'
import { normalizeScanTarget } from '@/lib/url.ts'

/**
 * Step 1 — "What site should we watch?"
 *
 * Pure presentation. The wizard owns the URL state; this component
 * reports it up on submit. Validation reuses `normalizeScanTarget` so
 * a typo comes back instantly instead of after the round trip to
 * /api/onboarding/check, and so the wizard's later steps can trust
 * the URL it has without re-validating.
 *
 * The same shape as ScanForm's input — rounded card, pill button,
 * "Website address" label, "example.com" placeholder — so a user who
 * has just typed their URL into the dashboard scan box does not have
 * to learn a new field. The skin tokens here are the console tokens
 * because this page lives under (app).
 */

export interface OnboardingStepUrlProps {
  /** Called with a normalized, validated URL when the user submits. */
  onSubmit: (normalizedUrl: string, hostname: string) => void
  /** Pre-fill the field — used when the user is sent back here from a later step. */
  initialValue?: string
}

export function OnboardingStepUrl({ onSubmit, initialValue = '' }: OnboardingStepUrlProps) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const inputId = useId()
  const errorId = useId()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = normalizeScanTarget(value)
    if (!target.ok) {
      setError(target.reason)
      return
    }
    setError(null)
    setPending(true)
    // The submit is local — no async — but we still flip the button
    // into its pending state so the "Probe" transition feels instant
    // rather than the input snapping off the screen.
    onSubmit(target.url, target.hostname)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-6">
      <label htmlFor={inputId} className="label text-c-muted">
        Website address
      </label>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input
          id={inputId}
          name="url"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="example.com"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            if (error !== null) setError(null)
          }}
          disabled={pending}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 rounded-xl border border-c-line bg-c-card px-5 py-3.5 text-[15px] text-c-ink
                     placeholder:text-c-muted focus-visible:outline-2 focus-visible:outline-offset-1
                     focus-visible:outline-c-ink disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-c-ink px-7 py-3.5 text-[14px] font-medium text-c-brand-ink
                     transition-opacity hover:opacity-90 disabled:opacity-60 sm:w-auto"
        >
          {pending ? 'Probing…' : 'Probe this site'}
        </button>
      </div>

      <p id={errorId} role="alert" aria-live="polite" className="mt-2 min-h-5 text-[13px] text-sev-high">
        {error}
      </p>
    </form>
  )
}
