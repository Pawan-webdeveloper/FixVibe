/**
 * safeNextPath is the guard on `?next=` — an attacker-controlled query value
 * that becomes a redirect target after sign-in. The whole point of it is to
 * refuse anything that would leave our origin, so these cases are mostly the
 * ways a string can look same-site and not be: a protocol-relative "//host",
 * and the backslash the URL parser folds into a slash ("/\\host" -> "//host").
 * A miss here is an open redirect that lends our domain to a phishing page.
 */

import { describe, expect, it } from 'vitest'
import { safeNextPath } from '../lib/next-path.ts'

describe('safeNextPath', () => {
  it('passes an ordinary same-site path through unchanged', () => {
    expect(safeNextPath('/dashboard')).toBe('/dashboard')
    expect(safeNextPath('/scan/9f5b816f-f20d')).toBe('/scan/9f5b816f-f20d')
    expect(safeNextPath('/welcome?next=/dashboard')).toBe('/welcome?next=/dashboard')
  })

  it('allows a lone slash — it is the origin root', () => {
    expect(safeNextPath('/')).toBe('/')
  })

  it('rejects a protocol-relative path that escapes the origin', () => {
    expect(safeNextPath('//evil.test')).toBe('/dashboard')
    expect(safeNextPath('//evil.test/path')).toBe('/dashboard')
  })

  it('rejects a backslash the URL parser folds into a slash', () => {
    // new URL('/\\evil.test', origin) resolves to //evil.test — off-origin.
    expect(safeNextPath('/\\evil.test')).toBe('/dashboard')
    expect(safeNextPath('/\\/evil.test')).toBe('/dashboard')
  })

  it('rejects an absolute URL, a non-slash start, and empty input', () => {
    expect(safeNextPath('https://evil.test')).toBe('/dashboard')
    expect(safeNextPath('evil.test')).toBe('/dashboard')
    expect(safeNextPath('')).toBe('/dashboard')
    expect(safeNextPath(null)).toBe('/dashboard')
  })

  it('never returns an off-origin target for any of its accepted values', () => {
    const origin = 'https://scanlyfix.com'
    for (const raw of ['/dashboard', '/', '//evil.test', '/\\evil.test', 'https://evil.test', null]) {
      const host = new URL(safeNextPath(raw), origin).host
      expect(host).toBe('scanlyfix.com')
    }
  })
})
