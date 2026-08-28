import { describe, expect, it, beforeEach, vi } from 'vitest'
import { landingAuthStorage } from '@/components/auth/landing-auth-storage.ts'

/** A minimal in-memory localStorage stand-in. */
function installLocalStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
  vi.stubGlobal('window', { localStorage: store })
  return map
}

const NS = '_httpsdeploymentconvexcloud'
const REFRESH = `__convexAuthRefreshToken${NS}`
const JWT = `__convexAuthJWT${NS}`

describe('landingAuthStorage', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('hides the refresh token so the provider cannot refresh "dummy" against Convex', () => {
    installLocalStorage({ [REFRESH]: 'dummy', [JWT]: 'header.payload.sig' })
    const storage = landingAuthStorage()

    // The refresh token is invisible — this is what stops the crash.
    expect(storage.getItem(REFRESH)).toBeNull()
    // The JWT is still readable, so the page still knows there is a session.
    expect(storage.getItem(JWT)).toBe('header.payload.sig')
  })

  it('also hides a real two-part refresh token, not just the sentinel', () => {
    installLocalStorage({ [REFRESH]: 'realid|realsession' })
    expect(landingAuthStorage().getItem(REFRESH)).toBeNull()
  })

  it('drops writes to the refresh token but persists everything else', () => {
    const map = installLocalStorage()
    const storage = landingAuthStorage()

    storage.setItem(REFRESH, 'dummy')
    storage.setItem(JWT, 'a.b.c')

    expect(map.has(REFRESH)).toBe(false)
    expect(map.get(JWT)).toBe('a.b.c')
  })

  it('passes reads and removes of other keys straight through', () => {
    const map = installLocalStorage({ [JWT]: 'a.b.c', other: 'x' })
    const storage = landingAuthStorage()

    expect(storage.getItem('other')).toBe('x')
    storage.removeItem(JWT)
    expect(map.has(JWT)).toBe(false)
  })

  it('degrades to a no-op store when localStorage throws (private window)', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new DOMException('denied', 'SecurityError')
      },
    })

    const storage = landingAuthStorage()
    // None of these may throw — the landing page must render regardless.
    expect(storage.getItem(JWT)).toBeNull()
    expect(() => storage.setItem(JWT, 'a.b.c')).not.toThrow()
    expect(() => storage.removeItem(JWT)).not.toThrow()
  })
})
