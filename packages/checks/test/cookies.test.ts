/**
 * Set-Cookie parsing tests. The parser feeds the cookie-flags check (Phase 1),
 * and its one hard rule is privacy: cookie VALUES must never survive parsing —
 * scan results end up in a database and in front of other people.
 */

import { describe, expect, it } from 'vitest'
import { parseSetCookies } from '../src/context/cookies.ts'

const headersWith = (...setCookies: string[]): Headers => {
  const headers = new Headers()
  for (const value of setCookies) headers.append('set-cookie', value)
  return headers
}

describe('parseSetCookies', () => {
  it('extracts the name and all three security attributes', () => {
    const cookies = parseSetCookies(headersWith('sid=abc123; Path=/; Secure; HttpOnly; SameSite=Lax'))
    expect(cookies).toEqual([{ name: 'sid', secure: true, httpOnly: true, sameSite: 'Lax' }])
  })

  it('defaults every attribute to off/null for a bare cookie', () => {
    expect(parseSetCookies(headersWith('plain=1'))).toEqual([
      { name: 'plain', secure: false, httpOnly: false, sameSite: null },
    ])
  })

  it('reads attributes case-insensitively but preserves the SameSite value as sent', () => {
    const cookies = parseSetCookies(headersWith('a=1; SECURE; httponly; SAMESITE=strict'))
    expect(cookies).toEqual([{ name: 'a', secure: true, httpOnly: true, sameSite: 'strict' }])
  })

  it('handles multiple Set-Cookie headers independently', () => {
    const cookies = parseSetCookies(headersWith('a=1; Secure', 'b=2; HttpOnly'))
    expect(cookies.map((c) => c.name)).toEqual(['a', 'b'])
    expect(cookies[0]).toMatchObject({ secure: true, httpOnly: false })
    expect(cookies[1]).toMatchObject({ secure: false, httpOnly: true })
  })

  it('drops nameless garbage instead of throwing', () => {
    expect(parseSetCookies(headersWith('; Path=/', '=value; Secure'))).toEqual([])
  })

  it('never retains cookie values (privacy contract)', () => {
    const [cookie] = parseSetCookies(headersWith('session=SUPER_SECRET_TOKEN; Secure'))
    expect(JSON.stringify(cookie)).not.toContain('SUPER_SECRET_TOKEN')
  })
})
