/**
 * Turning a request into a Viewer, in exactly one place.
 *
 * One function producing the Viewer means one place to audit when you worry
 * whether users can read each other's data — and every query that can reach
 * another account already refuses to run without one.
 *
 * This is also the seam an identity provider swap has to touch, and it has now
 * been used as one: it read Supabase, it reads Convex, and nothing below it
 * changed either time. The Viewer carries this application's own user id, never
 * the provider's — see users.authSubject for why that indirection exists.
 */

import 'server-only'
import { redirect } from 'next/navigation'
import { ANONYMOUS, getUserContext, userIdForAuthSubject, type UserContext, type Viewer } from '@scanlyfix/db'
import { currentIdentity } from './auth/convex.ts'

export async function getViewer(): Promise<Viewer> {
  const identity = await currentIdentity()
  if (!identity) return ANONYMOUS

  /*
   * A valid token with no application row is treated as signed OUT, not as an
   * error. It means the callback that runs ensureUser never completed — a
   * closed tab mid-sign-in, most likely — and the repair is to send them back
   * through it. Throwing here would strand them on an error page with nothing
   * to press.
   */
  const userId = await userIdForAuthSubject(identity.subject)
  return userId ? { kind: 'user', userId } : ANONYMOUS
}

/**
 * For pages under (app), which have no logged-out state. Returns the account
 * context the shell needs, so a layout does not fetch it a second time.
 */
export async function requireUser(nextPath?: string): Promise<UserContext> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') redirect(loginUrl(nextPath))

  const context = await getUserContext(viewer.userId)
  // getViewer only returns a user id it found in this table, so a miss here is
  // a row deleted mid-request. Sending them to sign in again is the honest
  // answer; 500ing is not.
  if (!context) redirect(loginUrl(nextPath))

  return context
}

function loginUrl(nextPath?: string): string {
  return nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : '/login'
}

/**
 * `next` comes from a query string, so it is attacker-controlled. Only a
 * same-site path is ever followed; anything else — an absolute URL, a
 * protocol-relative "//evil.test" — would make this an open redirect that
 * borrows our domain's credibility for a phishing page.
 */
export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard'
  return value
}
