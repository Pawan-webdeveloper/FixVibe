import { describe, expect, it } from 'vitest'
import { describeSignInError } from '@/components/auth/sign-in-error.ts'

/**
 * The error-message filter for failed sign-ins.
 *
 * The whitelist rule is provider-agnostic — the same `scanlyfix:` marker
 * pattern would work with Supabase Auth, Convex Auth, or anything else — so
 * the previously Convex-shaped tests stay useful after the migration.
 */
describe('describeSignInError', () => {
  it('shows a sentence we marked as written for the reader', () => {
    const cause = new Error(
      'scanlyfix:Sign-in by email is not available yet on this site. Continue with Google or GitHub instead.',
    )

    expect(describeSignInError(cause)).toBe(
      'Sign-in by email is not available yet on this site. Continue with Google or GitHub instead.',
    )
  })

  it('finds the marked sentence inside an SDK wrapper', () => {
    // The real shape, from the logs: Supabase prefixes the underlying provider
    // message with its own request context, and wraps errors in objects whose
    // `.message` is the string we wrote. The marker survives the wrapping.
    const cause = new Error(
      'AuthApiError: scanlyfix:Sign-in by email is not available yet on this site. Continue with Google or GitHub instead.\n    at signInWithOtp (supabase-js.ts:42:7)',
    )

    expect(describeSignInError(cause)).toBe(
      'Sign-in by email is not available yet on this site. Continue with Google or GitHub instead.',
    )
  })

  it('never repeats an unmarked provider message', () => {
    // The regression this guards: a provider's 403 used to name the
    // account owner's personal email address, and was rendered on a public
    // sign-in page verbatim. Every operator's own address would end up
    // here — that is the whole point.
    const cause = new Error(
      'You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain.',
    )

    const shown = describeSignInError(cause)
    expect(shown).toBe('That did not work. Try again in a moment.')
    expect(shown).not.toContain('owner@example.com')
    expect(shown).not.toContain('verify a domain')
  })

  it('does not leak a stack trace or request id', () => {
    const cause = new Error(
      '[Request ID: abc123] Server Error\nUncaught Error: Something internal\n    at parse (refreshTokens.ts:49:9)',
    )

    const shown = describeSignInError(cause)
    expect(shown).toBe('That did not work. Try again in a moment.')
    expect(shown).not.toContain('Request ID')
    expect(shown).not.toContain('parseRefreshToken')
  })

  it('falls back for something that is not an Error at all', () => {
    expect(describeSignInError('a string')).toBe('That did not work. Try again in a moment.')
    expect(describeSignInError(null)).toBe('That did not work. Try again in a moment.')
    expect(describeSignInError(undefined)).toBe('That did not work. Try again in a moment.')
    expect(describeSignInError({ message: 'scanlyfix:not an Error' })).toBe(
      'That did not work. Try again in a moment.',
    )
  })

  it('falls back when the marker is there but the sentence is empty', () => {
    expect(describeSignInError(new Error('scanlyfix:'))).toBe('That did not work. Try again in a moment.')
    expect(describeSignInError(new Error('scanlyfix:   '))).toBe(
      'That did not work. Try again in a moment.',
    )
  })

  /**
   * The Supabase SDK puts its own error code on `error.code`. Mapping codes
   * (not messages) to safe text means a third party cannot smuggle arbitrary
   * strings onto the sign-in page by changing the SDK's wording.
   */
  it('maps the Supabase redirect_uri_not_in_whitelist code to a safe sentence', () => {
    const cause = Object.assign(new Error('redirect_uri not in whitelist'), { code: 'redirect_uri_not_in_whitelist' })
    const shown = describeSignInError(cause)
    expect(shown).toContain('misconfigured')
    expect(shown).not.toContain('redirect_uri')
  })

  it('maps email_provider_disabled to the friendly fallback', () => {
    const cause = Object.assign(new Error('Email signups are disabled'), { code: 'email_provider_disabled' })
    expect(describeSignInError(cause)).toContain('Email sign-in is not available')
  })

  it('does not trust an arbitrary code that is not in the whitelist', () => {
    const cause = Object.assign(new Error('arbitrary provider error'), { code: 'something_internal' })
    expect(describeSignInError(cause)).toBe('That did not work. Try again in a moment.')
  })
})
