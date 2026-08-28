/**
 * POST /api/scan — the endpoint the landing page's form talks to.
 *
 * Deliberately thin. It validates, throttles, and delegates; the scan itself
 * lives in lib/scan/run-scan-job.ts so that moving it onto a queue later is a
 * change of caller rather than a rewrite of this file.
 *
 * The order of the five steps is load-bearing:
 *
 *   1. normalize   — re-run on the server, because the client already did and
 *                    the client is not trusted.
 *   2. dedup       — before either limit, so a repeat visitor gets an instant
 *                    answer without spending anything, and the target is not
 *                    fetched twice for the same question.
 *   3. quota       — the account's monthly allowance. Before the rate limit so
 *                    that somebody who is out of scans is told THAT, rather
 *                    than a sentence about the last hour that does not explain
 *                    why tomorrow will not help either.
 *   4. rate limit  — abuse protection, which protects the TARGET rather than
 *                    us, and therefore applies to everyone including paying
 *                    accounts.
 *   5. run         — the only step that touches somebody else's server.
 *
 * A signed-in scan is attributed with `requestedBy`. Without that a logged-in
 * person scanning from the landing page produced an anonymous scan: it never
 * appeared in their history and never counted against their plan.
 */

import { NextResponse } from 'next/server'
import { findRecentAnonymousScan, type ScanProfile } from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import { checkScanQuota } from '@/lib/quota.ts'
import { normalizeScanTarget } from '@/lib/url.ts'
import { assertServerEnv } from '@/lib/env.ts'
import { clientIpHash } from '@/lib/request.ts'
import { checkScanAllowed, DEDUP_WINDOW_MS } from '@/lib/ratelimit.ts'
import { runScanJob, startScanJob } from '@/lib/scan/run-scan-job.ts'

/** The engine uses node:dns, node:net and node:tls; it cannot run on the edge. */
export const runtime = 'nodejs'

/**
 * Measured scan times today are 90ms to 2.2s. The ceiling is for a slow target
 * that exhausts its probe budget — not the expected case, but the one that
 * would otherwise be killed mid-write and leave a scan stuck in 'running'.
 */
export const maxDuration = 60

interface ScanBody {
  url?: unknown
  profile?: unknown
}

const PROFILES: readonly ScanProfile[] = ['fast', 'deep']

function isProfile(value: unknown): value is ScanProfile {
  return typeof value === 'string' && PROFILES.includes(value as ScanProfile)
}

function fail(error: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error }, { status, headers })
}

export async function POST(request: Request) {
  try {
    assertServerEnv()
  } catch (error) {
    console.error('[api/scan] environment is not configured', error)
    return fail('The scanner is not configured correctly. This is a problem on our side.', 500)
  }

  let body: ScanBody
  try {
    body = (await request.json()) as ScanBody
  } catch {
    return fail('Expected a JSON body containing a url.', 400)
  }

  if (typeof body.url !== 'string') {
    return fail('Expected a JSON body containing a url.', 400)
  }

  const target = normalizeScanTarget(body.url)
  if (!target.ok) return fail(target.reason, 400)

  // Absent means fast. An unrecognised value is rejected rather than coerced:
  // silently downgrading a caller who asked for depth would give them a report
  // missing the very checks they asked for, with nothing to say why.
  const profile: ScanProfile = body.profile === undefined ? 'fast' : (body.profile as ScanProfile)
  if (!isProfile(profile)) return fail(`Unknown scan profile. Use one of: ${PROFILES.join(', ')}.`, 400)

  /*
   * A scan requires an account, and the check sits BEFORE the dedup cache on
   * purpose: a cached result handed to a signed-out caller is still a scan they
   * got without signing in. The 401 is the server's half of the landing page's
   * gate — the browser also redirects a signed-out visitor to /login, but the
   * cookie is the only thing that cannot be faked by a stale client token, so
   * this is where "signing in is required to scan" is actually enforced.
   *
   * The client turns this status into a trip to /login, not an error message.
   */
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return fail('Sign in to run a scan. It takes a moment and keeps your reports.', 401)
  }

  // A hit here means we already asked this exact question recently. Reusing the
  // answer protects the target, the account's quota, and their patience.
  const cached = await findRecentAnonymousScan(target.url, profile, new Date(Date.now() - DEDUP_WINDOW_MS))
  if (cached) return NextResponse.json({ scanId: cached.id, cached: true })

  const quota = await checkScanQuota(viewer)
  if (!quota.ok) return fail(quota.reason, 429)

  const anonIpHash = clientIpHash(request.headers)
  const verdict = await checkScanAllowed({ anonIpHash, targetHost: target.hostname })
  if (!verdict.ok) {
    return fail(verdict.reason, 429, { 'retry-after': String(verdict.retryAfterSeconds) })
  }

  const job = {
    url: target.url,
    profile,
    anonIpHash,
    requestedBy: viewer.kind === 'user' ? viewer.userId : null,
  }

  try {
    /*
     * A fast scan finishes in about two seconds, so the request waits for it
     * and the caller gets a finished report. A deep one cannot: the row is
     * reserved, the id comes back immediately, and the client polls
     * /api/scan/[scanId]/status while the queue does the work.
     */
    if (profile === 'deep') {
      const scanId = await startScanJob(job)
      await inngest.send({ name: EVENTS.scanRequested, data: { scanId, ...job } })
      return NextResponse.json({ scanId, queued: true })
    }

    const scanId = await runScanJob(job)
    return NextResponse.json({ scanId })
  } catch (error) {
    // runScanJob records a failed SCAN itself and still returns an id, so
    // reaching here means something below it broke — the database, most
    // likely. The visitor gets a sentence; the detail goes to the log.
    console.error('[api/scan] could not record the scan', error)
    return fail('Could not start the scan. Please try again in a moment.', 500)
  }
}
