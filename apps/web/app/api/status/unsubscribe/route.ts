/**
 * apps/web/app/api/status/unsubscribe/route.ts
 *
 * GET /api/status/unsubscribe?token=…
 *
 * Public — no auth. Soft-deletes the subscriber and redirects to a
 * generic landing page. Idempotent: clicking an already-unsubscribed
 * link lands on the same page without erroring.
 *
 * Responses:
 *   302 → /status/unsubscribed        — always, whether the token
 *                                       matched or not
 *
 * The token is the same one used for confirm, by design — see
 * status-subscribers.ts for the rationale. The unsubscribe page renders
 * a one-line confirmation regardless of whether the row was found, so
 * the URL does not become a probe for "is this email subscribed".
 */

import { NextResponse } from 'next/server'
import { unsubscribeByToken } from '@scanlyfix/db'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')

  // Token absent → refuse rather than silently succeed; the unsubscribe
  // link is what subscribers click, and an empty token is a malformed link.
  if (!token) {
    return NextResponse.redirect(new URL('/status/unsubscribed', url))
  }

  await unsubscribeByToken(token)

  // Same destination whether the token matched or not. The landing page
  // shows the project name in its copy IF we know which project the
  // token belonged to — the query helper returns null either way for a
  // not-found case, so we deliberately do not expose it here.
  return NextResponse.redirect(new URL('/status/unsubscribed', url))
}
