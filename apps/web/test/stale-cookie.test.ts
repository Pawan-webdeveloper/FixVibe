import { describe, expect, it } from 'vitest'
import {
  JWT_COOKIES,
  REFRESH_TOKEN_COOKIES,
  isUsableRefreshCookie,
} from '@/lib/auth/stale-cookie.ts'

describe('isUsableRefreshCookie', () => {
  it('accepts the two-part token a live deployment issues', () => {
    expect(isUsableRefreshCookie('jd74n7a5yamd|jh7a4w908m52')).toBe(true)
  })

  it('rejects a value with no session half — the stale-deployment case', () => {
    // This is the shape that made the backend throw "Can't parse refresh token"
    // after the app was pointed at a new Convex deployment.
    expect(isUsableRefreshCookie('jd74n7a5yamd')).toBe(false)
  })

  it('rejects either half being empty', () => {
    expect(isUsableRefreshCookie('|jh7a4w908m52')).toBe(false)
    expect(isUsableRefreshCookie('jd74n7a5yamd|')).toBe(false)
    expect(isUsableRefreshCookie('|')).toBe(false)
  })

  it('rejects an empty value', () => {
    expect(isUsableRefreshCookie('')).toBe(false)
  })

  it('rejects the client-only "dummy" sentinel — a cookie holds the real token', () => {
    // Unlike the localStorage check, a cookie should never carry "dummy"; if one
    // did it would be unusable and must be cleared, not kept.
    expect(isUsableRefreshCookie('dummy')).toBe(false)
  })
})

describe('cookie name lists', () => {
  it('covers both the localhost and production (__Host-) forms', () => {
    expect(REFRESH_TOKEN_COOKIES).toContain('__convexAuthRefreshToken')
    expect(REFRESH_TOKEN_COOKIES).toContain('__Host-__convexAuthRefreshToken')
    expect(JWT_COOKIES).toContain('__convexAuthJWT')
    expect(JWT_COOKIES).toContain('__Host-__convexAuthJWT')
  })
})
