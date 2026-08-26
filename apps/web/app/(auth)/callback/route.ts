/**
 * Where both sign-in flows land.
 *
 * Supabase hands back a one-time code; exchanging it sets the session cookie.
 * The one thing this route owns beyond that is ensureUser() — the app's own
 * users row, personal organization and free subscription are created here, so
 * every later page can assume they exist rather than checking.
 */

import { NextResponse } from 'next/server'
import { ensureUser } from '@darvin/db'
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

  return NextResponse.redirect(new URL(next, url.origin))
}
