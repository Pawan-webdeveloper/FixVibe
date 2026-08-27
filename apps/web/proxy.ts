/**
 * Session refresh on every request.
 *
 * Convex Auth's access tokens are short-lived; without something rotating them
 * the session dies mid-use and every signed-in page starts failing
 * intermittently. `convexAuthNextjsMiddleware` is what performs that rotation
 * and rewrites the cookie. That is all it does.
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
 * A refresh token belongs to the deployment that issued it. After the app was
 * repointed to a new Convex deployment, browsers still carrying the old
 * `__convexAuthRefreshToken` cookie made the library's own refresh throw
 * `Can't parse refresh token` — an unhandledRejection that takes the request
 * down instead of degrading to signed-out, and which the sign-in path cannot
 * clear because it refreshes the same doomed cookie on the way through.
 *
 * So before the library sees the request, an unparseable refresh cookie is
 * stripped from it, and the response is told to clear it from the browser. The
 * visitor is simply signed out — the honest state for a credential no backend
 * can read — and can sign in again cleanly. A well-formed cookie is left
 * untouched, so a normal session pays nothing for this.
 */

import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server'
import { convexAuthNextjsMiddleware } from '@convex-dev/auth/nextjs/server'
import {
  JWT_COOKIES,
  REFRESH_TOKEN_COOKIES,
  isUsableRefreshCookie,
} from '@/lib/auth/stale-cookie.ts'

const convexMiddleware = convexAuthNextjsMiddleware()

/**
 * The refresh-token cookie names present on this request that the backend could
 * not parse. Usually empty; non-empty only for a browser left over from a
 * previous deployment.
 */
function unparseableRefreshCookies(request: NextRequest): string[] {
  return REFRESH_TOKEN_COOKIES.filter((name) => {
    const value = request.cookies.get(name)?.value
    return value !== undefined && !isUsableRefreshCookie(value)
  })
}

/**
 * A Set-Cookie line that erases one cookie.
 *
 * Written as a header rather than through `response.cookies` because the auth
 * proxy's response for the /api/auth path is a plain `Response`, which has no
 * cookies helper. `__Host-` cookies were set with Secure, and a clearing cookie
 * must match those attributes to replace them, so the prefix carries Secure.
 */
function clearCookie(name: string): string {
  const secure = name.startsWith('__Host-') ? '; Secure' : ''
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const doomed = unparseableRefreshCookies(request)

  if (doomed.length === 0) {
    // The overwhelming common case: a normal session, or none at all.
    return convexMiddleware(request, event)
  }

  /*
   * Hide the bad cookie from the library so its refresh never runs on a value
   * it will throw on. The JWT is dropped alongside it: on its own it reads as
   * signed in until it expires and then has no refresh token behind it.
   */
  const toClear = [...doomed, ...JWT_COOKIES]
  for (const name of toClear) {
    request.cookies.delete(name)
  }

  const response = (await convexMiddleware(request, event)) ?? NextResponse.next()

  // Tell the browser to drop them too, so the next request arrives clean
  // instead of repeating this every time. Appended as headers so this works
  // whether the library handed back a NextResponse or a plain Response.
  for (const name of toClear) {
    response.headers.append('Set-Cookie', clearCookie(name))
  }

  return response
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
