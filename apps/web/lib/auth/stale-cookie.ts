/**
 * Recognising an auth cookie the current deployment can no longer read.
 *
 * A refresh token is written by one Convex deployment and only that deployment
 * can parse it — server-side, `parseRefreshToken` splits it on `|` into a
 * refresh-token id and a session id, both of which are rows in that
 * deployment's own tables. Point the app at a different deployment (as happened
 * here, moving from shiny-sparrow-790 to reminiscent-mockingbird-621) and every
 * browser still holding the old cookie sends a value the new backend throws on:
 *
 *   Uncaught Error: Can't parse refresh token: <redacted>
 *     at parseRefreshToken (.../refreshTokens.ts:49)
 *
 * The throw is an unhandledRejection inside the auth middleware's own refresh,
 * so it takes down the request rather than degrading to "signed out". The user
 * cannot sign in OUT of the state either, because the sign-in path refreshes
 * the same doomed cookie on the way through.
 *
 * The client-side counterpart of this lives in repair-token-storage.ts, which
 * clears the localStorage copy. This is the half the middleware needs: the
 * cookie is a separate store the client repair cannot reach.
 */

/** The base names Convex Auth uses; production prefixes them with `__Host-`. */
const REFRESH_TOKEN_BASE = '__convexAuthRefreshToken'
const JWT_BASE = '__convexAuthJWT'

/** Both the localhost form and the production `__Host-` form of each name. */
export const REFRESH_TOKEN_COOKIES = [REFRESH_TOKEN_BASE, `__Host-${REFRESH_TOKEN_BASE}`]
export const JWT_COOKIES = [JWT_BASE, `__Host-${JWT_BASE}`]

/**
 * Whether a refresh-token COOKIE value is one the backend can parse.
 *
 * Stricter than the localStorage check in repair-token-storage.ts, and
 * deliberately so: a cookie always holds the REAL `id|sessionId` token, never
 * the client-only "dummy" sentinel. So the only acceptable shape here is the
 * two-part one; a "dummy" that somehow reached a cookie is itself unusable.
 *
 * Mirrors the server's `parseRefreshToken`: split on the divider, require both
 * halves. A shape check, not a validity one — a well-formed token for a session
 * that no longer exists already fails cleanly as "signed out" without throwing.
 */
export function isUsableRefreshCookie(value: string): boolean {
  const [refreshTokenId, sessionId] = value.split('|')
  return Boolean(refreshTokenId) && Boolean(sessionId)
}
