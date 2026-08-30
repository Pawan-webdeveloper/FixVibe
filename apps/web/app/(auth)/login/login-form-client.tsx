'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useSupabaseClient } from '@/components/auth/supabase-context.ts'
import { LogoBadge } from '@/components/brand/logo.tsx'
import { GitHubMark, GoogleMark } from '@/components/auth/provider-marks.tsx'
import { describeSignInError } from '@/components/auth/sign-in-error.ts'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'
import { SupabaseAuthProvider } from '@/components/auth/supabase-provider.tsx'
import { publicEnv } from '@/lib/public-env.ts'

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
 * The Supabase Auth client handles the three flows: `signInWithOAuth` for the
 * two providers, `signInWithOtp` for the email code, and `verifyOtp` for
 * redeeming the code. The application-side /callback route runs after any of
 * them, creating the row in the Postgres `users` table.
 *
 * There is no password field anywhere in this product, which removes an entire
 * category of breach: no hashing to get wrong, no reset flow to phish, and
 * nothing in a database dump worth cracking.
 *
 * ## Sign in vs sign up
 *
 * With no password, the two are the SAME action underneath — a new address
 * creates an account, a known one signs in — so this is one page with a toggle
 * rather than two routes with duplicated flows that could drift. The toggle
 * exists because "which one is this?" is a real question a person arrives with,
 * and answering it in the heading, the button copy and the URL (`?mode=`) costs
 * nothing and removes the doubt. The buttons do the identical thing in both
 * modes; only the framing changes.
 *
 * ## Why a client-only island
 *
 * The form depends on `useSupabaseClient()`, which requires the Supabase
 * React context. The (auth) layout mounts `SupabaseAuthProvider` above this
 * page, but in Next 16 with React 19, when a server component renders a
 * client provider, the children prop is RSC-serialized — and the form's
 * server render of `useSupabaseClient()` does not see the context the
 * provider supplies. The form throws during SSR.
 *
 * The fix used here is the same pattern the marketing landing page's
 * `HeroScanFormClient` uses: a client island that renders a server-friendly
 * placeholder until mount, then mounts the provider + form together. SSR
 * never tries to evaluate the form; the placeholder holds the space.
 */

const BUTTON =
  'label inline-flex h-11 w-full items-center justify-center gap-3 px-6 transition-colors duration-150'
const PRIMARY = `${BUTTON} border border-ink bg-ink text-canvas hover:bg-transparent hover:text-ink`
const SECONDARY = `${BUTTON} border border-line hover:bg-surface`
const FIELD =
  'h-11 w-full border border-line bg-canvas px-4 text-sm placeholder:text-muted ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'

type Mode = 'signin' | 'signup'

/** The copy that differs between the two, in one place so they stay in step. */
const COPY: Record<Mode, { label: string; heading: string; emailCta: string; codeCta: string; foot: string }> = {
  signin: {
    label: 'Sign in',
    heading: 'Welcome back',
    emailCta: 'Email me a code',
    codeCta: 'Sign in',
    foot: 'Signing in is what runs a scan, and it keeps every report you make.',
  },
  signup: {
    label: 'Sign up',
    heading: 'Create your account',
    emailCta: 'Send me a code',
    codeCta: 'Create account',
    foot: 'No password to choose. Pick a provider or use your email, and your account is made on first sign-in.',
  },
}

/** What the URL says went wrong, in words the person can act on. */
const ERRORS: Record<string, string> = {
  'sign-in-failed': 'That sign-in did not complete. Try again.',
  'account-setup-failed': 'We could not finish setting up your account. Try again in a moment.',
  'no-email':
    'That account did not share an email address with us. Make your GitHub email public, or sign in with a code instead.',
}

/** The two-card switch at the top. Cheap, and it answers "which one is this?". */
function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div role="tablist" aria-label="Sign in or sign up" className="grid grid-cols-2 border border-line">
      {(['signin', 'signup'] as const).map((value) => {
        const active = value === mode
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(value)}
            className={`label h-11 transition-colors duration-150 ${
              active ? 'bg-ink text-canvas' : 'text-muted hover:bg-surface hover:text-ink'
            }`}
          >
            {COPY[value].label}
          </button>
        )
      })}
    </div>
  )
}

function LoginForm() {
  const params = useSearchParams()
  const next = params.get('next') ?? ''
  const supabase = useSupabaseClient()

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'signin')
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'start' | 'code'>('start')
  const [pending, setPending] = useState<'google' | 'github' | 'email' | null>(null)
  const [error, setError] = useState<string | null>(ERRORS[params.get('error') ?? ''] ?? null)

  const copy = COPY[mode]

  /**
   * Where Supabase Auth sends the browser once the session cookie is set.
   *
   * Built from `publicEnv.appUrl()` — the deployment's public URL — rather
   * than `window.location.origin`. A visitor hitting the app through a
   * preview deploy, a stale DNS, or `localhost` in production would
   * otherwise have Supabase hand the session back to a URL that is not on
   * the configured redirect allowlist, and the round-trip would 404 or
   * silently fail. The post-mount check against `publicEnv.redirectAllowlist`
   * catches the misconfiguration before the request is made, so the form
   * shows a clear "this app is misconfigured" message instead of letting
   * the user click through to a broken Supabase redirect.
   */
  const redirectTo = useMemo(() => {
    const origin = publicEnv.appUrl()
    return next ? `${origin}/auth/callback?next=${encodeURIComponent(next)}` : `${origin}/auth/callback`
  }, [next])

  /**
   * The callback URL the Supabase client will redirect to, paired with the
   * allowlist entry it must match. Computed once per render so the two
   * strings cannot drift.
   */
  const callbackUrl = `${publicEnv.appUrl()}/auth/callback`

  /*
   * Keep the chosen mode in the URL without a navigation, so a refresh holds it
   * and the landing page can deep-link to /login?mode=signup. replaceState
   * rather than a router push keeps this page statically prerendered.
   */
  function changeMode(nextMode: Mode) {
    setMode(nextMode)
    setError(null)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.set('mode', nextMode)
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
  }

  /**
   * Thrown when the deployment's app URL is not on the redirect allowlist, so
   * the message can be thrown to `describeSignInError` and the form shows
   * something specific instead of the generic "did not work" fallback. The
   * `scanlyfix:` prefix is what makes `describeSignInError` trust the text.
   */
  function assertAllowlisted(): void {
    const allowlist = publicEnv.redirectAllowlist()
    if (allowlist.length === 0) return
    if (allowlist.includes(callbackUrl)) return
    throw new Error(
      `scanlyfix:This sign-in is misconfigured: ${callbackUrl} is not on the redirect allowlist. ` +
        'Update NEXT_PUBLIC_APP_URL and SUPABASE_REDIRECT_ALLOWLIST to match the Supabase dashboard.',
    )
  }

  async function withProvider(provider: 'google' | 'github') {
    setPending(provider)
    setError(null)
    try {
      assertAllowlisted()
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      })
      if (oauthError) throw oauthError
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
      assertAllowlisted()
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true, emailRedirectTo: redirectTo },
      })
      if (otpError) throw otpError
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
    const form = new FormData(event.currentTarget)
    const code = String(form.get('code') ?? '').trim()
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: 'email',
      })
      if (verifyError) throw verifyError

      /*
       * Navigate ourselves, because verifyOtp does not. It verifies, sets the
       * session cookie, and returns WITHOUT redirecting — the SDK only uses
       * `emailRedirectTo` on the magic-link flow, and we are on the
       * token (code) flow. Left to itself the page just sits on /login with a
       * valid session and never runs /callback, so ensureUser never creates
       * the account row and every signed-in page then bounces back here.
       *
       * A full-document navigation rather than a client push: /callback is a
       * server route that reads the freshly set auth cookie, and the request
       * for it has to carry that cookie.
       */
      window.location.assign(redirectTo)
    } catch {
      // Deliberately not the provider's message. An expired code and a
      // mistyped one both produce the same SDK error, and neither is worth
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
            {pending ? 'Checking…' : copy.codeCta}
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
      <ModeSwitch mode={mode} onChange={changeMode} />

      <h1 className="mt-6 mb-6 text-2xl font-semibold tracking-[-0.02em]">{copy.heading}</h1>

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
          {pending === 'email' ? 'Sending…' : copy.emailCta}
        </button>
      </form>

      <Problem message={error} />

      {/* The quiet cross-link, so somebody on the wrong card is one tap away. */}
      <p className="mt-6 text-sm text-muted">
        {mode === 'signin' ? (
          <>
            New to ScanlyFix?{' '}
            <button type="button" onClick={() => changeMode('signup')} className="link">
              Create an account
            </button>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <button type="button" onClick={() => changeMode('signin')} className="link">
              Sign in
            </button>
          </>
        )}
      </p>
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

/**
 * The server-rendered placeholder. Identical pixels to the form's first
 * paint so hydration does not shift the layout.
 */
function LoginFormSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 border border-line" aria-hidden="true">
        <div className="h-11 border-r border-line" />
        <div className="h-11" />
      </div>
      <h1 className="mt-6 mb-6 h-8 w-48 border border-line bg-surface" />
      <div className="flex flex-col gap-3" aria-hidden="true">
        <div className="h-11 w-full border border-ink bg-ink" />
        <div className="h-11 w-full border border-line" />
      </div>
    </>
  )
}

/**
 * The client-only island. Renders the skeleton during SSR, then mounts
 * the Supabase provider and the form together once the client is alive.
 */
export function LoginFormClient() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <LoginFormSkeleton />
  }

  return (
    <SupabaseAuthProvider>
      <Suspense fallback={<LoginFormSkeleton />}>
        <LoginForm />
      </Suspense>
    </SupabaseAuthProvider>
  )
}
