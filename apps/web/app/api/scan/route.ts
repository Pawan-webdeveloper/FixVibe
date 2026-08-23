/**
 * POST /api/scan — the endpoint the landing page's form talks to.
 *
 * Deliberately thin. It validates, throttles, and delegates; the scan itself
 * lives in lib/scan/run-scan-job.ts so that moving it onto a queue later is a
 * change of caller rather than a rewrite of this file.
 *
 * The order of the four steps is load-bearing:
 *
 *   1. normalize   — re-run on the server, because the client already did and
 *                    the client is not trusted.
 *   2. dedup       — before the limiter, so a repeat visitor gets an instant
 *                    answer without spending their quota, and the target is
 *                    not fetched twice for the same question.
 *   3. rate limit  — after dedup, so only work that will actually happen is
 *                    counted against anyone.
 *   4. run         — the only step that touches somebody else's server.
 */

import { NextResponse } from 'next/server'
import { findRecentAnonymousScan } from '@darvin/db'
import { normalizeScanTarget } from '@/lib/url.ts'
import { assertServerEnv } from '@/lib/env.ts'
import { clientIpHash } from '@/lib/request.ts'
import { checkScanAllowed, DEDUP_WINDOW_MS } from '@/lib/ratelimit.ts'
import { runScanJob } from '@/lib/scan/run-scan-job.ts'

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

  // A hit here means we already asked this exact question recently. Reusing the
  // answer protects the target, the visitor's quota, and their patience.
  const cached = await findRecentAnonymousScan(target.url, 'fast', new Date(Date.now() - DEDUP_WINDOW_MS))
  if (cached) return NextResponse.json({ scanId: cached.id, cached: true })

  const anonIpHash = clientIpHash(request.headers)
  const verdict = await checkScanAllowed({ anonIpHash, targetHost: target.hostname })
  if (!verdict.ok) {
    return fail(verdict.reason, 429, { 'retry-after': String(verdict.retryAfterSeconds) })
  }

  try {
    const scanId = await runScanJob({ url: target.url, profile: 'fast', anonIpHash })
    return NextResponse.json({ scanId })
  } catch (error) {
    // runScanJob records a failed SCAN itself and still returns an id, so
    // reaching here means something below it broke — the database, most
    // likely. The visitor gets a sentence; the detail goes to the log.
    console.error('[api/scan] could not record the scan', error)
    return fail('Could not start the scan. Please try again in a moment.', 500)
  }
}
