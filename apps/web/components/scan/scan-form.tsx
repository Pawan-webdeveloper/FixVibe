'use client'

import { useId, useRef } from 'react'
import { useScanSubmit } from './use-scan-submit.ts'

/**
 * The standard scan form, used wherever the page is not the hero.
 *
 * Presentation only: everything that decides whether a scan starts lives in
 * useScanSubmit, which the hero's form calls too.
 */
export function ScanForm() {
  const inputId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  // No `restore`: a visitor coming back from sign-in lands at the top of the
  // page, where the hero already reclaims the URL. Two forms both taking it
  // would race for one key and then fight over the focus.
  const { value, setValue, pending, error, submit } = useScanSubmit()

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const started = await submit()
    if (!started) inputRef.current?.focus()
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
          onChange={(event) => setValue(event.target.value)}
          disabled={pending}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 border border-line bg-surface px-4 py-3 font-mono text-base text-ink placeholder:text-muted disabled:opacity-60"
        />

        <button
          type="submit"
          disabled={pending}
          className="bg-accent px-6 py-3 text-base font-medium text-accent-ink disabled:opacity-60 sm:w-auto"
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
