'use client'

import { useState } from 'react'

/**
 * Posts to a billing route and follows the URL Stripe returns.
 *
 * A button rather than a link because both endpoints must be POST: a GET that
 * creates a checkout session can be triggered by an image tag on another site,
 * and would leave stray sessions on the account.
 */
export function BillingButton({
  endpoint,
  label,
  variant = 'primary',
}: {
  endpoint: '/api/billing/checkout' | '/api/billing/portal'
  label: string
  variant?: 'primary' | 'secondary'
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function go() {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(endpoint, { method: 'POST' })
      const data = (await response.json()) as { url?: string; error?: string }
      if (!response.ok || !data.url) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        setPending(false)
        return
      }
      window.location.href = data.url
    } catch {
      setError('Could not reach the server. Check your connection.')
      setPending(false)
    }
  }

  const styles = variant === 'primary' ? 'bg-accent text-accent-ink' : 'border border-line hover:bg-surface'

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 ${styles}`}
      >
        {pending ? 'Opening…' : label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
