'use client'

import { useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { normalizeScanTarget } from '@/lib/url.ts'

/**
 * The one interaction on the landing page.
 *
 * Validation runs on the client purely so a typo comes back instantly instead
 * of after a round trip; the API route re-runs the same function, because
 * nothing arriving over the wire is trusted. The two can never disagree since
 * they call the same code.
 */
export function ScanForm() {
  const router = useRouter()
  const inputId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const target = normalizeScanTarget(value)
    if (!target.ok) {
      setError(target.reason)
      inputRef.current?.focus()
      return
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
        // The server owns the real verdict — an SSRF-blocked target, a site that
        // would not respond, a rate limit. Surface its sentence, not a status code.
        const detail: unknown = await response.json().catch(() => null)
        const reason =
          detail && typeof detail === 'object' && 'error' in detail && typeof detail.error === 'string'
            ? detail.error
            : `The scan could not be started (HTTP ${response.status}).`
        setError(reason)
        setPending(false)
        return
      }

      const { scanId } = (await response.json()) as { scanId: string }
      router.push(`/scan/${scanId}`)
    } catch {
      setError('Could not reach the scanner. Check your connection and try again.')
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full">
      <label htmlFor={inputId} className="block text-sm font-medium">
        Website address
      </label>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          ref={inputRef}
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
            if (error) setError(null)
          }}
          disabled={pending}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-4 py-3 font-mono text-base
                     text-ink placeholder:text-muted disabled:opacity-60"
        />

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-6 py-3 text-base font-medium text-accent-ink
                     disabled:opacity-60 sm:w-auto"
        >
          {pending ? 'Scanning…' : 'Scan'}
        </button>
      </div>

      {/* Announced to screen readers when it appears, not only when focused. */}
      <p id={errorId} role="alert" aria-live="polite" className="mt-2 min-h-5 text-sm text-danger">
        {error}
      </p>
    </form>
  )
}
