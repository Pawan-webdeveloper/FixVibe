/**
 * Where both sign-in flows land.
 *
 * Supabase hands back a one-time code; exchanging it sets the session cookie.
 * The one thing this route owns beyond that is ensureUser() — the app's own
 * users row, personal organization and free subscription are created here, so
 * every later page can assume they exist rather than checking.
 *
 * This file and getViewer() are the entire surface an auth provider swap has
 * to touch. Everything downstream takes a Viewer and never learns where it
 * came from.
 */

import { NextResponse } from 'next/server'
import { ensureUser, getUserContext } from '@darvin/db'
import { createSupabaseServerClient } from '@/lib/supabase/server.ts'
import { safeNextPath } from '@/lib/authz.ts'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = safeNextPath(url.searchParams.get('next'))

  if (!code) return NextResponse.redirect(new URL('/login?error=missing-code', url.origin))

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user?.email) {
    console.error('[auth/callback] code exchange failed', error)
    return NextResponse.redirect(new URL('/login?error=sign-in-failed', url.origin))
  }

  try {
    await ensureUser({ id: data.user.id, email: data.user.email })
  } catch (dbError) {
    // The session is valid but the account row is not there. Sending them on
    // would produce a logged-in user whose every page 404s; failing here is
    // recoverable, because retrying the link runs this again.
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
    const context = await getUserContext(data.user.id)
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
