import type { TokenStorage } from '@convex-dev/auth/react'
import { REFRESH_TOKEN_COOKIES } from '@/lib/auth/stale-cookie.ts'

/**
 * The storage the landing page's client-only Convex Auth provider reads.
 *
 * ## Why the refresh token is hidden
 *
 * Sign-in happens through the Next.js (cookie) flow: the real refresh token
 * lives in a cookie the server rotates, and localStorage holds only the
 * sentinel `"dummy"`. Every other page reads the session through that same
 * server flow, but the landing page stays static and mounts a CLIENT-only
 * provider instead — and that provider refreshes tokens by calling Convex
 * directly, not through /api/auth.
 *
 * So when it wakes up, it reads `"dummy"` from localStorage and sends it
 * straight to Convex as a refresh token. The backend splits a refresh token on
 * `|`, `"dummy"` has none, and it throws `Can't parse refresh token` — an
 * uncaught rejection on the first page a visitor sees, for every signed-in
 * user who lands here.
 *
 * This storage hides the refresh token from that provider. Reads of it return
 * null, so the provider simply has nothing to refresh with and never makes the
 * doomed call. The JWT is still read, so the page still knows whether someone
 * is signed in — which is all it needs the token for, to decide the hero's scan
 * gate. When the JWT expires the page falls back to signed-out, and the real
 * session is picked up again the moment they move into the app, where the
 * cookie flow governs. Writes of the refresh token are dropped too, so the
 * client-only flow never persists a value of its own over the cookie flow's.
 *
 * Only the landing page uses this. The (auth) and (app) layouts read the
 * session server-side and are unaffected.
 */

/** The base name, without the namespace suffix Convex appends. */
const REFRESH_TOKEN_KEY = '__convexAuthRefreshToken'

/** True for the refresh-token key under any deployment namespace. */
function isRefreshTokenKey(key: string): boolean {
  // Cover the bare name and, defensively, the __Host- form the cookie side uses.
  return REFRESH_TOKEN_COOKIES.some((name) => key.startsWith(name)) || key.startsWith(REFRESH_TOKEN_KEY)
}

/**
 * localStorage with the refresh-token key blanked out. Falls back to a no-op
 * store when localStorage cannot be reached (private windows, blocked data),
 * so the provider degrades to signed-out rather than throwing.
 */
export function landingAuthStorage(): TokenStorage {
  let store: Storage | null = null
  try {
    store = window.localStorage
  } catch {
    store = null
  }

  return {
    getItem(key: string) {
      if (isRefreshTokenKey(key)) return null
      try {
        return store?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    setItem(key: string, value: string) {
      if (isRefreshTokenKey(key)) return
      try {
        store?.setItem(key, value)
      } catch {
        // Nothing to do — a landing-page session is best-effort.
      }
    },
    removeItem(key: string) {
      try {
        store?.removeItem(key)
      } catch {
        // As above.
      }
    },
  }
}
