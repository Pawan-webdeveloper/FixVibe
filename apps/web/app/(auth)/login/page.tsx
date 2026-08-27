'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useAuthActions } from '@convex-dev/auth/react'
import { BrandMark } from '@/components/marketing/brand-mark.tsx'
import { GitHubMark, GoogleMark } from '@/components/auth/provider-marks.tsx'
import { describeSignInError } from '@/components/auth/sign-in-error.ts'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'

/**
 * Three ways in, none of them a password.
 *
 * Google and GitHub are one click and leave no credential of ours to store. For
 * everyone else, a six-digit code to the address they type — a CODE rather than
 * a magic link, because a link has to survive a corporate mail scanner
 * rewriting it, opening in whichever browser the mail client prefers, and being
 * clicked in the same session it was asked for. A code is read with the eyes
 * and typed into the tab that is already open.
 *
 * There is no password field anywhere in this product, which removes an entire
 * category of breach: no hashing to get wrong, no reset flow to phish, and
 * nothing in a database dump worth cracking.
 */

const BUTTON =
  'label inline-flex h-11 w-full items-center justify-center gap-3 px-6 transition-colors duration-150'
const PRIMARY = `${BUTTON} border border-ink bg-ink text-canvas hover:bg-transparent hover:text-ink`
const SECONDARY = `${BUTTON} border border-line hover:bg-surface`
const FIELD =
  'h-11 w-full border border-line bg-canvas px-4 text-sm placeholder:text-muted ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

/** What the URL says went wrong, in words the person can act on. */
const ERRORS: Record<string, string> = {
  'sign-in-failed': 'That sign-in did not complete. Try again.',
  'account-setup-failed': 'We could not finish setting up your account. Try again in a moment.',
  'no-email':
    'That account did not share an email address with us. Make your GitHub email public, or sign in with a code instead.',
}

function LoginForm() {
  const params = useSearchParams()
  const next = params.get('next') ?? ''
  const { signIn } = useAuthActions()

  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'start' | 'code'>('start')
  const [pending, setPending] = useState<'google' | 'github' | 'email' | null>(null)
  const [error, setError] = useState<string | null>(ERRORS[params.get('error') ?? ''] ?? null)

  /** Where Convex Auth sends the browser once the session cookie is set. */
  const redirectTo = next ? `/callback?next=${encodeURIComponent(next)}` : '/callback'

  async function withProvider(provider: 'google' | 'github') {
    setPending(provider)
    setError(null)
    try {
      await signIn(provider, { redirectTo })
    } catch (cause) {
      setPending(null)
      setError(describeSignInError(cause))
    }
  }

  async function requestCode(event: React.FormEvent) {
    event.preventDefault()
    setPending('email')
    setError(null)
    try {
      const form = new FormData()
      form.set('email', email)
      await signIn('resend-otp', form)
      setStep('code')
    } catch (cause) {
      setError(describeSignInError(cause))
    } finally {
      setPending(null)
    }
  }

  async function submitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending('email')
    setError(null)
    try {
      const form = new FormData(event.currentTarget)
      // The address goes back with the code on purpose. The provider checks
      // that the code was issued for THIS address, so a code read from someone
      // else's screen cannot be redeemed against another account.
      form.set('email', email)
      form.set('redirectTo', redirectTo)
      await signIn('resend-otp', form)

      /*
       * Navigate ourselves, because signIn will not. On the OAuth path it does
       * a window.location redirect from inside the library; on the code path it
       * verifies, sets the session token, and returns WITHOUT redirecting —
       * `redirectTo` is only consulted by the OAuth flow. Left to itself the
       * page just sits on /login with a valid session and never runs /callback,
       * so ensureUser never creates the account row and every signed-in page
       * then bounces back here.
       *
       * A full-document navigation rather than a client push: /callback is a
       * server route that reads the freshly set auth cookie, and the request
       * for it has to carry that cookie.
       */
      window.location.assign(redirectTo)
    } catch {
      // Deliberately not the provider's message. "Token not found" is what an
      // expired code and a mistyped one both produce, and neither is worth
      // translating into something that sounds like our fault.
      setError('That code is not right, or it has expired. Ask for a new one.')
      setPending(null)
    }
  }

  if (step === 'code') {
    return (
      <>
        <p className="text-[15px] leading-relaxed text-muted text-pretty">
          We sent a six-digit code to <span className="text-ink">{email}</span>. It expires in 15
          minutes and works once.
        </p>

        <form onSubmit={submitCode} className="mt-6 flex flex-col gap-3">
          <label htmlFor="code" className="label text-muted">
            Code
          </label>
          <input
            id="code"
            name="code"
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            // Six digits, digits only. The pattern is what makes a phone show a
            // number pad and what lets the browser offer the code it just saw
            // arrive in a message.
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="000000"
            className={`${FIELD} text-center text-lg tracking-[0.4em]`}
          />
          <button type="submit" disabled={pending !== null} className={`${PRIMARY} disabled:opacity-60`}>
            {pending ? 'Checking…' : 'Sign in'}
          </button>
        </form>

        <Problem message={error} />

        <button
          type="button"
          onClick={() => {
            setStep('start')
            setError(null)
          }}
          className="label mt-6 text-muted transition-colors hover:text-ink"
        >
          ← Use a different address
        </button>
      </>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => withProvider('google')}
          disabled={pending !== null}
          className={`${PRIMARY} disabled:opacity-60`}
        >
          <GoogleMark />
          {pending === 'google' ? 'Opening Google…' : 'Continue with Google'}
        </button>
        <button
          type="button"
          onClick={() => withProvider('github')}
          disabled={pending !== null}
          className={`${SECONDARY} disabled:opacity-60`}
        >
          <GitHubMark />
          {pending === 'github' ? 'Opening GitHub…' : 'Continue with GitHub'}
        </button>
      </div>

      <div className="my-6 flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
        <span className="label text-muted">or</span>
        <span aria-hidden="true" className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={requestCode} className="flex flex-col gap-3">
        <label htmlFor="email" className="label text-muted">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={pending !== null}
          placeholder="you@example.com"
          className={`${FIELD} disabled:opacity-60`}
        />
        <button type="submit" disabled={pending !== null} className={`${SECONDARY} disabled:opacity-60`}>
          {pending === 'email' ? 'Sending…' : 'Email me a code'}
        </button>
      </form>

      <Problem message={error} />
    </>
  )
}

function Problem({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-4 border border-line bg-surface px-4 py-3 text-sm">
      ▲ {message}
    </p>
  )
}


export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm px-6 py-24">
      <Link href="/" className="flex items-center gap-2" aria-label="ScanlyFix — home">
        <BrandMark size={16} track="var(--line)" arc="var(--ink)" />
        <span className="text-[15px] font-semibold tracking-tight">scanlyfix</span>
      </Link>
      <div className="mt-8">
        <LabeledRule label="Sign in" trailing="no password" />
      </div>
      <h1 className="mt-5 mb-8 text-2xl font-semibold tracking-[-0.02em]">Keep your reports</h1>
      {/* useSearchParams needs a Suspense boundary to keep the page static. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <p className="mt-8 text-sm text-muted">
        No password, ever. Scanning works without an account — signing in is for keeping your
        reports.
      </p>
    </div>
  )
}
