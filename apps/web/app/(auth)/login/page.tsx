'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client.ts'

/**
 * Two ways in, both passwordless.
 *
 * GitHub because the audience is developers and it is one click with no
 * credential for us to store. A magic link for everyone else — also nothing
 * stored. There is no password field anywhere in this product, which removes
 * an entire category of breach.
 */
function LoginForm() {
  const params = useSearchParams()
  const next = params.get('next') ?? ''
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  /** The callback validates this again server-side; it is not trusted here. */
  const callback = () => {
    const url = new URL('/callback', window.location.origin)
    if (next) url.searchParams.set('next', next)
    return url.toString()
  }

  async function sendMagicLink(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback() },
    })
    setPending(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  async function signInWithGithub() {
    setPending(true)
    setError(null)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: callback() },
    })
    if (error) {
      setPending(false)
      setError(error.message)
    }
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-line bg-surface p-6">
        <h2 className="font-medium">Check your inbox</h2>
        <p className="mt-2 text-sm text-muted">
          A sign-in link is on its way to <span className="font-mono">{email}</span>. It expires in an
          hour and can only be used once.
        </p>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={signInWithGithub}
        disabled={pending}
        className="w-full rounded-md bg-ink px-4 py-3 text-sm font-medium text-canvas disabled:opacity-60"
      >
        Continue with GitHub
      </button>

      <div className="my-6 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={sendMagicLink} className="flex flex-col gap-3">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          placeholder="you@example.com"
          className="rounded-md border border-line bg-surface px-4 py-3 text-base disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-line px-4 py-3 text-sm font-medium hover:bg-surface disabled:opacity-60"
        >
          {pending ? 'Sending…' : 'Email me a sign-in link'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  )
}

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm px-6 py-24">
      <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
        darvin
      </Link>
      <h1 className="mt-6 mb-8 text-2xl font-semibold">Sign in</h1>
      {/* useSearchParams needs a Suspense boundary to keep the page static. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <p className="mt-8 text-sm text-muted">
        No password, ever. Scanning works without an account — signing in is for keeping your reports.
      </p>
    </div>
  )
}
