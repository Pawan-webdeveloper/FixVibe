/**
 * The Supabase OAuth landing URL — where the PKCE code becomes a session.
 *
 * `@supabase/ssr` pins both of its clients to `flowType: 'pkce'`, so an OAuth
 * provider does NOT hand back a session. It hands back a one-time `?code=`,
 * and that code is worth nothing until it is traded for tokens against the
 * matching code verifier. Until this route ran that trade, no auth cookie
 * existed, `/callback` asked `getUser()` and was told nobody was signed in,
 * and every Google and GitHub sign-in ended on `/login?error=sign-in-failed`.
 *
 * ## Why the exchange happens here, on the server
 *
 * The verifier was written as a cookie when `signInWithOAuth` started the
 * flow, so the server client — which reads and writes cookies through
 * `next/headers` — is the only half of the app that can both read the
 * verifier and set the resulting session cookie on the response. A Route
 * Handler is one of the two places Next allows a cookie write, which is
 * exactly why the exchange belongs in one.
 *
 * ## The flow id
 *
 * Newer auth-js versions key each concurrent PKCE attempt under its own
 * verifier slot and name the attempt in an `sb_flow_id` query parameter. The
 * client reads that from `window.location`; on the server there is no
 * `window`, so it has to be passed explicitly. Without it a browser that
 * started two sign-ins could redeem the second code against the first
 * attempt's verifier. With it, a miss fails fast instead of borrowing
 * another flow's secret.
 *
 * ## Email codes do not come through the exchange
 *
 * `verifyOtp` returns a session directly and the browser client writes the
 * cookie itself, so that flow arrives here with no `code` at all and is
 * simply forwarded. One landing URL, two ways of already being signed in.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server.ts'
// Straight from the dependency-free module rather than through authz.ts, which
// re-exports it alongside the whole identity and database stack. This route
// runs on every sign-in and needs one string check, not that graph.
import { safeNextPath } from '@/lib/next-path.ts'

export const runtime = 'nodejs'

/** auth-js names the concurrent-flow slot with this query parameter. */
const FLOW_ID_PARAM = 'sb_flow_id'

export async function GET(request: Request) {
  const url = new URL(request.url)
  // Validated before it is ever used as a redirect target: `next` arrives from
  // a query string, so it is attacker-controlled like any other.
  const next = safeNextPath(url.searchParams.get('next'))

  const failed = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin))

  /*
   * The provider refused, or the person pressed "Cancel" on the consent
   * screen. Supabase forwards that as `error` / `error_description`. The
   * description is deliberately NOT put in our URL — it is provider text that
   * can name an address or an internal reason, and the login page has a
   * sentence of its own for this.
   */
  if (url.searchParams.get('error')) {
    console.warn('[auth/callback] provider refused the sign-in:', url.searchParams.get('error'))
    return failed('sign-in-failed')
  }

  const code = url.searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const flowId = url.searchParams.get(FLOW_ID_PARAM)

    const { error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    )

    if (error) {
      // A code that was already redeemed, expired, or whose verifier cookie is
      // missing (a different browser finished the flow). All of them mean the
      // same thing to the person: start again.
      console.warn('[auth/callback] could not exchange the code for a session:', error.message)
      return failed('sign-in-failed')
    }
  }

  /*
   * On to the application's own callback, which creates the users row. A
   * server-side redirect, so the cookie this route just set travels with the
   * next request — and `next` is re-encoded rather than passed through, so
   * only the sanitised value survives the hop.
   */
  const target = new URL('/callback', url.origin)
  target.searchParams.set('next', next)

  return NextResponse.redirect(target)
}
