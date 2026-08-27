import { describe, expect, it } from 'vitest'
import {
  corruptTokenKeys,
  isParsableRefreshToken,
} from '@/components/auth/repair-token-storage.ts'
import { describeSignInError } from '@/components/auth/sign-in-error.ts'

/** A well-formed token, as Convex Auth writes it: `refreshTokenId|sessionId`. */
const GOOD = 'k17abc123|js7def456'

describe('isParsableRefreshToken', () => {
  it('accepts the two-part form the server expects', () => {
    expect(isParsableRefreshToken(GOOD)).toBe(true)
  })

  it('rejects the single-id form an older release wrote', () => {
    // This is the value that produced "Can't parse refresh token" and left the
    // browser throwing on every page load.
    expect(isParsableRefreshToken('k17abc123')).toBe(false)
  })

  it('rejects a token missing either half', () => {
    expect(isParsableRefreshToken('|js7def456')).toBe(false)
    expect(isParsableRefreshToken('k17abc123|')).toBe(false)
    expect(isParsableRefreshToken('|')).toBe(false)
  })

  it('rejects an empty value', () => {
    expect(isParsableRefreshToken('')).toBe(false)
  })
})

describe('corruptTokenKeys', () => {
  it('drops nothing when the stored token is usable', () => {
    const entries = [
      ['__convexAuthRefreshToken_httpsshinysparrow790convexcloud', GOOD],
      ['__convexAuthJWT_httpsshinysparrow790convexcloud', 'header.payload.signature'],
    ] as const

    expect(corruptTokenKeys(entries)).toEqual([])
  })

  it('drops the bad refresh token and the JWT sharing its namespace', () => {
    const ns = '_httpsshinysparrow790convexcloud'
    const entries = [
      [`__convexAuthRefreshToken${ns}`, 'k17abc123'],
      [`__convexAuthJWT${ns}`, 'header.payload.signature'],
    ] as const

    // The JWT goes too: on its own it reads as signed in until it expires, and
    // then has no refresh token behind it to recover with.
    expect(corruptTokenKeys(entries).sort()).toEqual(
      [`__convexAuthJWT${ns}`, `__convexAuthRefreshToken${ns}`].sort(),
    )
  })

  it('does not name a JWT key that is not in storage', () => {
    const ns = '_deployment'
    const entries = [[`__convexAuthRefreshToken${ns}`, 'no-divider']] as const

    expect(corruptTokenKeys(entries)).toEqual([`__convexAuthRefreshToken${ns}`])
  })

  it('leaves a healthy deployment alone while cleaning a broken one', () => {
    const entries = [
      ['__convexAuthRefreshToken_alpha', 'k1|s1'],
      ['__convexAuthJWT_alpha', 'jwt-alpha'],
      ['__convexAuthRefreshToken_beta', 'corrupt'],
      ['__convexAuthJWT_beta', 'jwt-beta'],
    ] as const

    expect(corruptTokenKeys(entries).sort()).toEqual(
      ['__convexAuthJWT_beta', '__convexAuthRefreshToken_beta'].sort(),
    )
  })

  it('ignores keys that are not Convex Auth refresh tokens', () => {
    const entries = [
      ['scanlyfix:pending-scan-url', 'https://example.com/'],
      ['__convexAuthOAuthVerifier_ns', 'anything'],
      ['__convexAuthServerStateFetchTime_ns', '1700000000000'],
    ] as const

    expect(corruptTokenKeys(entries)).toEqual([])
  })

  it('handles empty storage', () => {
    expect(corruptTokenKeys([])).toEqual([])
  })
})

describe('describeSignInError', () => {
  it('shows a sentence we marked as written for the reader', () => {
    const cause = new Error(
      'scanlyfix:Sign-in by email is not available yet on this site. Continue with Google or GitHub instead.',
    )

    expect(describeSignInError(cause)).toBe(
      'Sign-in by email is not available yet on this site. Continue with Google or GitHub instead.',
    )
  })

  it('finds the marked sentence inside Convex’s own wrapper', () => {
    // Convex prefixes a request id and "Server Error" before the thrown message,
    // and appends its own stack after it. This is the real shape, from the logs.
    const cause = new Error(
      '[Request ID: 9e2a6dcfa567bf1b] Server Error\nUncaught Error: scanlyfix:Sign-in by email is not available yet on this site. Continue with Google or GitHub instead.\n    at sendVerificationRequest (../../convex/ResendOTP.ts:99:22)',
    )

    expect(describeSignInError(cause)).toBe(
      'Sign-in by email is not available yet on this site. Continue with Google or GitHub instead.',
    )
  })

  it('never repeats an unmarked provider message', () => {
    // The regression this guards: Resend's 403 names the ACCOUNT OWNER's email
    // address, and it was being rendered on a public sign-in page verbatim.
    // Every operator's own address would end up here — that is the whole point.
    const cause = new Error(
      'Uncaught Error: Could not send the sign-in code (HTTP 403). {"statusCode":403,"name":"validation_error","message":"You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain at resend.com/domains"}',
    )

    const shown = describeSignInError(cause)
    expect(shown).toBe('That did not work. Try again in a moment.')
    expect(shown).not.toContain('owner@example.com')
    expect(shown).not.toContain('resend.com')
    expect(shown).not.toContain('403')
  })

  it('does not leak a stack trace or request id', () => {
    const cause = new Error(
      '[Request ID: abc123] Server Error\nUncaught Error: Can’t parse refresh token: xyz\n    at parseRefreshToken (refreshTokens.ts:49:9)',
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
})
