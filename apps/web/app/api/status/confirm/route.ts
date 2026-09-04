/**
 * apps/web/app/api/status/confirm/route.ts
 *
 * GET /api/status/confirm?token=…
 *
 * Public — no auth. Flips a status_subscribers row to `confirmed = true`
 * and redirects the browser to the project status page with a query
 * flag so the UI can show "you're subscribed".
 *
 * Responses:
 *   302 → /status/<slug>?confirmed=1                 — confirm succeeded
 *   302 → /status/<slug>?unsubscribed=1             — token was already
 *                                                     unsubscribed (we
 *                                                     refuse to reactivate)
 *   302 → /status/<slug>?confirm-error=invalid      — token unknown
 *
 * The query-string flags are read by the status page (server-rendered)
 * and surface as a one-line banner. The browser is bounced through here
 * because email clients need a real link, and a real link needs a
 * navigable endpoint.
 */

import { NextResponse } from 'next/server'
import { confirmStatusSubscriber } from '@scanlyfix/db'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(new URL('/', url))
  }

  const result = await confirmStatusSubscriber(token)

  // Unknown or already-unsubscribed token — we cannot distinguish between
  // the two without leaking the existence of the row, so the user sees
  // "this link is invalid". Send them to a generic landing rather than
  // bounce them to a project page they may not know the slug of.
  if (!result) {
    return NextResponse.redirect(new URL('/?confirm-error=invalid', url))
  }

  return NextResponse.redirect(
    new URL(`/status/${result.project.slug}?confirmed=1`, url),
  )
}
