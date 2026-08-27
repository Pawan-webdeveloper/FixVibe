/**
 * GET /api/health — the probe a hosting platform calls to decide whether this
 * instance should receive traffic.
 *
 * Deliberately shallow. A health check that queries the database turns one
 * slow Postgres into every instance being marked unhealthy and pulled at
 * once, which is the outage the check was meant to prevent. What this answers
 * is the only question a load balancer is actually asking: is the Node process
 * up and serving? Whether a dependency is reachable is a question for the
 * status page, which is a different endpoint with a different audience.
 *
 * It reports which server-side environment variables are missing, because the
 * failure this catches in practice is a deploy that booted fine and cannot do
 * anything — the platform's dashboard is green and every scan returns 500. The
 * response names the variables and never their values.
 */

import { NextResponse } from 'next/server'
import { assertServerEnv } from '@/lib/env.ts'

export const runtime = 'nodejs'

/** Never cached: a cached health check reports the state of a past deploy. */
export const dynamic = 'force-dynamic'

export function GET() {
  let configured = true
  let detail: string | null = null

  try {
    assertServerEnv()
  } catch (error) {
    configured = false
    // The message names the missing variables, not their values — that is what
    // makes it safe to return, and it is the whole reason to return anything.
    detail = error instanceof Error ? error.message : 'The environment is incomplete.'
  }

  return NextResponse.json(
    {
      status: configured ? 'ok' : 'degraded',
      // Lets an operator tell a rolled-back deploy from a live one without
      // shelling in. Vercel and Railway both inject a commit SHA; absent that,
      // this is simply unknown rather than a lie.
      version:
        process.env['VERCEL_GIT_COMMIT_SHA'] ??
        process.env['RAILWAY_GIT_COMMIT_SHA'] ??
        process.env['GIT_COMMIT_SHA'] ??
        'unknown',
      ...(detail ? { detail } : {}),
    },
    {
      // 503 when the process is up but cannot serve a scan, so a platform that
      // gates traffic on this endpoint does not send anybody into a 500.
      status: configured ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  )
}
