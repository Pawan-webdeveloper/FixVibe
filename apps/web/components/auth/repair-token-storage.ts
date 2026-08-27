/**
 * Drops a stored refresh token the server will never accept, before the auth
 * client can try to use it.
 *
 * ## The failure this exists for
 *
 * Convex Auth keeps its refresh token in localStorage as
 * `refreshTokenId|sessionId`. A value that does not split into those two halves
 * makes the server's `parseRefreshToken` throw `Can't parse refresh token`, and
 * the client does not recover: `verifyCode` retries only NETWORK errors and
 * then rethrows, so the rejection escapes `fetchAccessToken` unhandled. Nothing
 * in the library clears the bad value.
 *
 * The result is a browser that is permanently broken rather than merely signed
 * out. Every page that mounts an auth provider throws on load — including the
 * landing page, which mounts one for the hero's scan form — and the only cure
 * is for the visitor to know to clear site data, which no visitor knows.
 *
 * A token gets into this state whenever the stored value came from somewhere
 * the current deployment cannot read: an older release that wrote the previous
 * single-id format, a different Convex deployment, or a half-finished sign-in.
 * That is not a rare event during a migration — it is what everybody who signed
 * in before the change is holding.
 *
 * ## Why a module-level repair
 *
 * `ConvexAuthNextjsProvider` accepts only `client` and `children` — there is no
 * `storage` prop to wrap, so the storage cannot be sanitised on read the way it
 * can for the plain React provider. Running the repair when this module is
 * imported puts it before any provider mounts, which is the ordering that
 * matters: the token has to be gone before the client reads it, not after.
 *
 * Removing the token signs the visitor out. That is the correct outcome — the
 * session it points at is unusable — and signing in again works immediately.
 */

/** Convex Auth's own key names, namespaced by deployment as `<key>_<ns>`. */
const REFRESH_TOKEN_KEY = '__convexAuthRefreshToken'
const JWT_KEY = '__convexAuthJWT'

/** What `parseRefreshToken` splits on, server-side. */
const DIVIDER = '|'

/**
 * The placeholder the Next.js integration writes into localStorage in place of
 * the refresh token.
 *
 * In the Next.js flow the real refresh token lives in a cookie that the proxy
 * middleware rotates server-side; the client is handed the sentinel "dummy" and
 * never the real value (see the library's nextjs/server/proxy: "The client has
 * a dummy refreshToken, the real one is only [in the cookie]"). So "dummy" is
 * not corruption — it is the normal, signed-IN state of this app, and deleting
 * it signs a working session out on the next page load. This is exactly the bug
 * this module caused: it read "dummy", saw no divider, and threw the session
 * away along with a perfectly valid JWT.
 */
const NEXTJS_SENTINEL = 'dummy'

/**
 * Whether the stored refresh token is one the app can keep using.
 *
 * Two shapes are fine. The sentinel "dummy" is the Next.js flow's normal state,
 * where the real token is in a cookie. A two-part `id|sessionId` value is the
 * React flow's real token — mirrors `parseRefreshToken`: split on the divider,
 * require both halves. Everything else is a value from an older format or a
 * different deployment that the server cannot read, and only those are cleared.
 *
 * Deliberately a shape check, not a validity check: whether the session still
 * exists is the server's question, and a well-formed token for a deleted
 * session already fails cleanly as "signed out" rather than throwing.
 */
export function isParsableRefreshToken(value: string): boolean {
  if (value === NEXTJS_SENTINEL) return true
  const [refreshTokenId, sessionId] = value.split(DIVIDER)
  return Boolean(refreshTokenId) && Boolean(sessionId)
}

/**
 * Given every key/value pair in storage, the keys that have to go.
 *
 * Pure, so the decision can be tested without a browser. Returns the corrupt
 * refresh token keys AND the JWT keys sharing their namespace: a JWT with no
 * usable refresh token behind it reads as signed in right up until it expires,
 * and then fails with no way back.
 */
export function corruptTokenKeys(entries: readonly (readonly [string, string])[]): string[] {
  const doomed: string[] = []

  for (const [key, value] of entries) {
    if (!key.startsWith(REFRESH_TOKEN_KEY)) continue
    if (isParsableRefreshToken(value)) continue

    doomed.push(key)
    // `__convexAuthRefreshToken_ns` -> `__convexAuthJWT_ns`
    doomed.push(JWT_KEY + key.slice(REFRESH_TOKEN_KEY.length))
  }

  // A JWT key is only worth removing if it is actually there.
  const present = new Set(entries.map(([key]) => key))
  return doomed.filter((key) => present.has(key))
}

/**
 * Run the repair against the real localStorage. A no-op on the server and
 * anywhere storage is unavailable.
 *
 * Never throws. This runs at import time on a page a stranger is looking at,
 * and a browser that refuses storage access — a private window, blocked site
 * data — must not take the page down over a repair that was only ever a
 * best-effort cleanup.
 */
export function repairTokenStorage(): void {
  if (typeof window === 'undefined') return

  try {
    const store = window.localStorage
    const entries: [string, string][] = []

    for (let index = 0; index < store.length; index++) {
      const key = store.key(index)
      if (key === null) continue
      const value = store.getItem(key)
      if (value !== null) entries.push([key, value])
    }

    for (const key of corruptTokenKeys(entries)) {
      store.removeItem(key)
      console.warn(`[auth] discarded an unusable stored credential (${key}); please sign in again`)
    }
  } catch {
    // Storage is not readable. There is nothing to repair and nothing to fail.
  }
}
