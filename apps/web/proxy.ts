/**
 * Session refresh on every request.
 *
 * Supabase access tokens are short-lived; without something rotating them the
 * session dies mid-use and every logged-in page starts failing intermittently.
 * That is all this does.
 *
 * It deliberately contains NO authorization. Gating routes here would give the
 * app a second, weaker copy of its access rules — and the copy that lives in
 * the query layer is the one that cannot be bypassed by reaching a page a
 * different way. Pages call requireUser(); queries take a Viewer. This file
 * only keeps the cookie fresh.
 *
 * Named `proxy` rather than `middleware`: Next 16 deprecated that convention.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
          response = NextResponse.next({ request })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // Reading the user is what triggers the refresh. The result is discarded on
  // purpose — authorization is not this file's job.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    /**
     * Everything except static assets and the anonymous scan endpoint.
     *
     * /api/scan is excluded deliberately: scanning must keep working logged
     * out, and running a session refresh on it would add a Supabase round trip
     * to the one request that is supposed to be fast.
     */
    '/((?!_next/static|_next/image|favicon.ico|api/scan|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
