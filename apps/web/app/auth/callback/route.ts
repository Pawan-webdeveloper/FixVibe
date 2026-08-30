/**
 * The Supabase OAuth landing URL.
 *
 * Supabase Auth hands the browser back to `${SITE_URL}/auth/callback` after
 * an OAuth provider approves the sign-in. The session cookie is set by the
 * redirect itself; this route's only job is to forward to the application's
 * own callback at `/callback?next=...`, which is where `ensureUser` runs to
 * create the row in the Postgres `users` table.
 *
 * The forward is a server-side redirect, so the freshly set Supabase auth
 * cookie travels with the request. The application-side callback reads it
 * via `currentIdentity()` and proceeds.
 *
 * Email-OTP sign-ins do not use this route. `verifyOtp` returns a session
 * directly; the client does `window.location.assign('/auth/callback?next=...')`
 * to land here without a code-flow detour.
 */

import { NextResponse } from 'next/server'
import { safeNextPath } from '@/lib/authz.ts'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const next = safeNextPath(url.searchParams.get('next'))

  const target = new URL('/callback', url.origin)
  target.searchParams.set('next', next)

  return NextResponse.redirect(target)
}
