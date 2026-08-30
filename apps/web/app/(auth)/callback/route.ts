/**
 * Where every sign-in lands, whichever way it started.
 *
 * Supabase Auth has already done the hard part by the time this runs: the
 * OAuth dance happens at the provider, the email-code check happens in the
 * browser via `verifyOtp`, and the session cookie is set. Both end up
 * here — OAuth via `/auth/callback` which forwards with the cookie, email
 * via `window.location.assign` from the sign-in form. What this route owns
 * is the APPLICATION's side of a new account — the users row, the personal
 * organization and the free subscription — created here so every later page
 * can assume they exist rather than checking.
 *
 * It is idempotent, because it runs on every sign-in and not only the first.
 * ensureUser upserts on the provider's subject.
 */

import { NextResponse } from 'next/server'
import { ensureUser, getUserContext } from '@scanlyfix/db'
import { currentIdentity } from '@/lib/auth/supabase.ts'
import { safeNextPath } from '@/lib/authz.ts'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const next = safeNextPath(url.searchParams.get('next'))

  const identity = await currentIdentity()
  if (!identity) {
    // Arriving here without a session means the sign-in did not complete —
    // a cancelled OAuth consent screen, most often.
    return NextResponse.redirect(new URL('/login?error=sign-in-failed', url.origin))
  }

  /*
   * An address is required to create the account, and one provider can decline
   * to give it: GitHub hides an email the person marked private. Rather than
   * inventing a placeholder that later collides with their real address, the
   * sign-in is refused with a message that names the fix.
   */
  if (!identity.email) {
    return NextResponse.redirect(new URL('/login?error=no-email', url.origin))
  }

  let userId: string
  try {
    userId = await ensureUser({ subject: identity.subject, email: identity.email })
  } catch (dbError) {
    // The session is valid but the account row is not there. Sending them on
    // would produce a signed-in user whose every page fails; stopping here is
    // recoverable, because signing in again runs this a second time.
    console.error('[auth/callback] could not create the account row', dbError)
    return NextResponse.redirect(new URL('/login?error=account-setup-failed', url.origin))
  }

  /*
   * A person who has never been asked what they care about is sent through the
   * one question, carrying their original destination so they land where they
   * were going. `priorities` is null only until it is answered once — an empty
   * answer is stored as an empty array precisely so this cannot loop.
   *
   * A failure to read it is not a reason to block a valid sign-in: the worst
   * case is that they are asked on their next visit instead.
   */
  try {
    const context = await getUserContext(userId)
    if (context?.priorities === null) {
      const welcome = new URL('/welcome', url.origin)
      welcome.searchParams.set('next', next)
      return NextResponse.redirect(welcome)
    }
  } catch (dbError) {
    console.error('[auth/callback] could not read onboarding state', dbError)
  }

  return NextResponse.redirect(new URL(next, url.origin))
}
