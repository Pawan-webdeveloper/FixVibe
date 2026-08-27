/**
 * Asking Convex who is holding this token.
 *
 * One function, one network call, and it is the entire coupling between this
 * application and its identity provider. Everything above it deals in a
 * `Viewer`; everything below it is Postgres.
 *
 * ## Why a round trip rather than reading the JWT
 *
 * The token is a signed JWT and its `sub` claim is the identity, so decoding it
 * locally would be free. Decoding is not verifying: the cookie is
 * attacker-supplied like any other, and an unverified claim is an
 * authorization bypass with extra steps. Verifying it properly means fetching
 * and caching Convex's JWKS, honouring key rotation and clock skew — a
 * security-critical path this codebase would then own.
 *
 * Convex Auth's own `isAuthenticatedNextjs` answers the same question the same
 * way, with a query against the deployment. This follows it.
 *
 * The cost is one call to Convex on requests that need an identity. Requests
 * that do not — an anonymous scan, the landing page — never reach it, because
 * the token is read from the cookie first and its absence is answered locally.
 */

import 'server-only'
import { fetchQuery } from 'convex/nextjs'
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server'
import { publicEnv } from '../public-env.ts'

export interface ConvexIdentity {
  /** The provider's stable id. Stored as users.auth_subject. */
  subject: string
  /**
   * Null is legitimate, not a failure: a GitHub account with a private address
   * proves an identity without exposing one. The callback asks for an address
   * only when it has to record one.
   */
  email: string | null
  name: string | null
}

/**
 * Referenced by name rather than through `convex/_generated/api`.
 *
 * The generated module only exists after `npx convex dev` has run, and this
 * application has to build without it — in CI, in a fresh clone, and for anyone
 * who never touches the auth deployment. Convex Auth's own Next.js helpers call
 * their functions this way for the same reason.
 */
const VIEWER_QUERY = 'users:viewer' as unknown as Parameters<typeof fetchQuery>[0]

export async function currentIdentity(): Promise<ConvexIdentity | null> {
  const token = await convexAuthNextjsToken()
  // No cookie, no call. This is the common case on every public page.
  if (!token) return null

  try {
    const identity = (await fetchQuery(VIEWER_QUERY, {}, { token, url: publicEnv.convexUrl() })) as
      | ConvexIdentity
      | null
    return identity ?? null
  } catch (error) {
    /*
     * An expired token, a deployment that is briefly unreachable, or auth that
     * has not been pushed yet. Treated as signed out rather than thrown: a
     * public page must not 500 because the identity provider blinked, and a
     * signed-in one redirects to /login, which is the honest outcome.
     */
    console.error('[auth] could not resolve the Convex identity', error)
    return null
  }
}
