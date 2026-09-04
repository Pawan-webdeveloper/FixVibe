'use client'

/*
 * Subscribe-to-updates form on the public status page.
 *
 * Posts to /api/status/subscribe with { slug, email }. The API enforces
 * the 5/hour rate limit and the body shape; the form just collects input
 * and shows the result inline. A success shows a "check your inbox"
 * message — the API deliberately returns the same message whether the
 * row already existed or not, so we cannot leak that here.
 */

import { useState, useTransition } from 'react'

interface StatusSubscribeFormProps {
  /** Project slug — sent as part of the body. */
  slug: string
}

export function StatusSubscribeForm({ slug }: StatusSubscribeFormProps) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<boolean>(false)
  const [isPending, startTransition] = useTransition()

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const trimmed = email.trim()
    if (trimmed.length === 0) {
      setError('Email is required')
      return
    }

    startTransition(async () => {
      const res = await fetch('/api/status/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, email: trimmed }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        retryAfterSeconds?: number
      }

      if (!res.ok) {
        setError(data.error ?? 'Could not subscribe — try again later')
        return
      }

      setSuccess(true)
      setEmail('')
    })
  }

  if (success) {
    return (
      <div
        role="status"
        data-testid="status-subscribe-success"
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
      >
        Check your inbox to confirm your subscription.
      </div>
    )
  }

  return (
    <form
      onSubmit={submit}
      data-testid="status-subscribe-form"
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
      noValidate
    >
      <label htmlFor="status-subscribe-email" className="sr-only">
        Email
      </label>
      <input
        id="status-subscribe-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isPending}
        placeholder="you@example.com"
        aria-invalid={error !== null}
        className="flex-1 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? 'Subscribing…' : 'Subscribe to updates'}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-600 sm:basis-full">
          {error}
        </p>
      )}
    </form>
  )
}
