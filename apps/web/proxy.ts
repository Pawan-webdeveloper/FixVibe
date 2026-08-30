/**
 * Session refresh on every request.
 *
 * Supabase Auth's access tokens are short-lived; without something rotating
 * them the session dies mid-use and every signed-in page starts failing
 * intermittently. The `@supabase/ssr` createServerClient performs that
 * rotation on every call to `auth.getUser()` and writes the refreshed
 * cookies through its `setAll` adapter. That is all this file does.
 *
 * It deliberately contains NO authorization. Gating routes here would give the
 * app a second, weaker copy of its access rules — and the copy that lives in
 * the query layer is the one that cannot be bypassed by reaching a page a
 * different way. Pages call requireUser(); queries take a Viewer. This file
 * only keeps the cookie fresh.
 *
 * Named `proxy` rather than `middleware`: Next 16 deprecated that convention.
 *
 * ## The stale-cookie guard around it
 *
 * A Supabase auth cookie is a JSON blob the SDK wrote. If the cookie's value
 * is not the JSON the SDK expects — from an older release, a different
 * Supabase project, or a half-finished sign-in — `createServerClient` will
 * throw when it tries to parse it. The throw happens before the request has a
 * chance to render, and the sign-in path itself refreshes the same cookie on
 * the way through, so a broken session can lock a visitor out entirely.
 *
 * So before the library sees the request, an unparseable Supabase auth
 * cookie is stripped from it, and the response is told to clear it from the
 * browser. The visitor is simply signed out — the honest state for a
 * credential no backend can read — and can sign in again cleanly. A
 * well-formed cookie is left untouched, so a normal session pays nothing
 * for this.
 */

import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import {
  SUPABASE_AUTH_COOKIES,
  isUsableSupabaseCookie,
} from '@/lib/auth/supabase-cookie.ts'
import { publicEnv } from '@/lib/public-env.ts'

/**
 * The Supabase auth cookie names present on this request that the backend
 * could not parse. Usually empty; non-empty only for a browser left over from
 * a previous deploy, a different project, or a corrupted state.
 */
function unparseableAuthCookies(request: NextRequest): string[] {
  return SUPABASE_AUTH_COOKIES.filter((name) => {
    const value = request.cookies.get(name)?.value
    return value !== undefined && !isUsableSupabaseCookie(value)
  })
}

/**
 * A Set-Cookie line that erases one cookie. `sb-` cookies (the Supabase
 * auth cookie is `sb-<ref>-auth-token`) are set with Secure in production,
 * and a clearing cookie must match those attributes to replace them.
 */
function clearCookie(name: string): string {
  const secure = name.startsWith('sb-') ? '; Secure' : ''
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const doomed = unparseableAuthCookies(request)

  // The overwhelming common case: a normal session, or none at all.
  if (doomed.length === 0) {
    return forwardWithSupabase(request, event)
  }

  // Hide the bad cookie from the library so it never sees a value it would
  // throw on.
  for (const name of doomed) {
    request.cookies.delete(name)
  }

  const response = (await forwardWithSupabase(request, event)) ?? NextResponse.next()

  // Tell the browser to drop them too, so the next request arrives clean
  // instead of repeating this every time. Appended as headers so this works
  // whether createServerClient handed back a NextResponse or a plain Response.
  for (const name of doomed) {
    response.headers.append('Set-Cookie', clearCookie(name))
  }

  return response
}

async function forwardWithSupabase(request: NextRequest, event: NextFetchEvent) {
  // Build a response that will receive any Set-Cookie the client emits when
  // it refreshes the session. createServerClient writes through the
  // getAll/setAll adapter below.
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(publicEnv.supabaseUrl(), publicEnv.supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        supabaseResponse = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options)
        }
      },
    },
  })

  // Touch the session. getUser() refreshes the access token when it is close
  // to expiry and writes the new value back through the adapter above. Do
  // not run any other auth code between createServerClient and getUser().
  await supabase.auth.getUser()
  // event is unused today; reserved for future abort signalling.
  void event

  return supabaseResponse
}

export const config = {
  matcher: [
    /**
     * Everything except static assets and the anonymous scan endpoint.
     *
     * /api/scan is excluded deliberately: scanning must keep working logged
     * out, and running a session refresh on it would add a round trip to the
     * identity provider on the one request that is supposed to be fast.
     */
    '/((?!_next/static|_next/image|favicon.ico|api/scan|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
