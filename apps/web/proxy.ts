/**
 * Session refresh on every request.
 *
 * Convex Auth's access tokens are short-lived; without something rotating them
 * the session dies mid-use and every signed-in page starts failing
 * intermittently. `convexAuthNextjsMiddleware` is what performs that rotation
 * and rewrites the cookie. That is all this does.
 *
 * It deliberately contains NO authorization. Gating routes here would give the
 * app a second, weaker copy of its access rules — and the copy that lives in
 * the query layer is the one that cannot be bypassed by reaching a page a
 * different way. Pages call requireUser(); queries take a Viewer. This file
 * only keeps the cookie fresh.
 *
 * Named `proxy` rather than `middleware`: Next 16 deprecated that convention.
 */

import { convexAuthNextjsMiddleware } from '@convex-dev/auth/nextjs/server'

export const proxy = convexAuthNextjsMiddleware()

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
