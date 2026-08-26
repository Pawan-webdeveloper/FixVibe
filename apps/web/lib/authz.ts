/**
 * Turning a request into a Viewer, in exactly one place.
 *
 * One function producing the Viewer means one place to audit when you worry
 * whether users can read each other's data — and every query that can reach
 * another account already refuses to run without one.
 *
 * In Phase 7 this grows an API-key branch and returns the same union, so route
 * handlers never learn there are two ways to authenticate.
 */

import 'server-only'
import { redirect } from 'next/navigation'
import { ANONYMOUS, getUserContext, type UserContext, type Viewer } from '@darvin/db'
import { createSupabaseServerClient } from './supabase/server.ts'

export async function getViewer(): Promise<Viewer> {
  const supabase = await createSupabaseServerClient()
  // getUser() validates the token with Supabase. getSession() reads the cookie
  // without verifying it, which is exactly the kind of shortcut that turns into
  // "anyone can forge a session" — never use it for an authorization decision.
  const { data } = await supabase.auth.getUser()
  return data.user ? { kind: 'user', userId: data.user.id } : ANONYMOUS
}

/**
 * For pages under (app), which have no logged-out state. Returns the account
 * context the shell needs, so a layout does not fetch it a second time.
 */
export async function requireUser(nextPath?: string): Promise<UserContext> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') redirect(loginUrl(nextPath))

  const context = await getUserContext(viewer.userId)
  // A valid session with no app row means the callback never ran ensureUser —
  // sending them back through it repairs the account rather than 500ing.
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
