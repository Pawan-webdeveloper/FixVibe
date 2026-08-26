/**
 * POST /api/v1/scan — start a scan from a machine.
 *
 *   curl -X POST https://darvin.dev/api/v1/scan \
 *        -H 'Authorization: Bearer dv_…' \
 *        -H 'content-type: application/json' \
 *        -d '{"url":"https://example.com","profile":"deep"}'
 *
 * The same five steps as /api/scan, in the same order, with two deliberate
 * differences — and both of them are the reason this is a separate handler
 * rather than a flag on that one.
 *
 * 1. NO DEDUP. The browser route answers a repeat request from a recent scan
 *    of the same URL, which is right for a visitor pasting a link twice. It is
 *    wrong here: a pipeline asking for a scan is asking about THIS deploy, and
 *    handing back a ten-minute-old reading would make the API's answer depend
 *    on whether a stranger happened to scan the same URL first. A green build
 *    that measured somebody else's commit is worse than a slow one.
 *
 * 2. RATE-LIMITED BY ACCOUNT, NOT BY ADDRESS. See checkApiScanAllowed — a CI
 *    fleet shares an egress address and rotates it, so the address is both too
 *    coarse and too easy to leave. The per-target limit still applies, because
 *    that one protects somebody else's server and no plan buys an exemption
 *    from it.
 *
 * Authentication is the bearer key and only the bearer key; the session cookie
 * is deliberately not honoured here. See lib/api-auth.ts.
 */

import { NextResponse } from 'next/server'
import { getProject, getScanForViewer, type ScanProfile } from '@darvin/db'
import { authenticateApiRequest } from '@/lib/api-auth.ts'
import { apiError, scanPath } from '@/lib/api-response.ts'
import { assertServerEnv } from '@/lib/env.ts'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import { checkScanQuota } from '@/lib/quota.ts'
import { checkApiScanAllowed } from '@/lib/ratelimit.ts'
import { normalizeScanTarget } from '@/lib/url.ts'
import { runScanJob, startScanJob } from '@/lib/scan/run-scan-job.ts'

export const runtime = 'nodejs'
export const maxDuration = 60

const PROFILES: readonly ScanProfile[] = ['fast', 'deep']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ScanBody {
  url?: unknown
  profile?: unknown
  projectId?: unknown
}

export async function POST(request: Request) {
  try {
    assertServerEnv()
  } catch (error) {
    console.error('[api/v1/scan] environment is not configured', error)
    return apiError('server_error', 'The scanner is not configured correctly.', 500)
  }

  const auth = await authenticateApiRequest(request)
  if (!auth.ok) return apiError(auth.status === 401 ? 'unauthorized' : 'forbidden', auth.error, auth.status)
  const { viewer } = auth.principal

  let body: ScanBody
  try {
    body = (await request.json()) as ScanBody
  } catch {
    return apiError('invalid_request', 'Expected a JSON body containing a url.', 400)
  }

  if (typeof body.url !== 'string') {
    return apiError('invalid_request', 'Expected a JSON body containing a url.', 400)
  }

  const target = normalizeScanTarget(body.url)
  if (!target.ok) return apiError('invalid_request', target.reason, 400)

  // Rejected rather than coerced. Silently downgrading a caller who asked for
  // depth returns a report missing the checks they asked for, and a pipeline
  // has no way to notice that it was quietly given something else.
  const profile = body.profile === undefined ? 'fast' : body.profile
  if (!PROFILES.includes(profile as ScanProfile)) {
    return apiError('invalid_request', `Unknown profile. Use one of: ${PROFILES.join(', ')}.`, 400)
  }

  /*
   * Attaching the scan to a project is what puts it in that project's history
   * and — for a domain-verified project — what lets the two backend checks
   * run. Ownership is re-checked here: the id in the body is a claim until
   * getProject agrees with it.
   *
   * A project that is not the caller's answers the same as one that does not
   * exist. Anything else lets a key holder enumerate other accounts' ids.
   */
  let projectId: string | null = null
  if (body.projectId !== undefined && body.projectId !== null) {
    if (typeof body.projectId !== 'string' || !UUID.test(body.projectId)) {
      return apiError('invalid_request', 'projectId must be a project UUID.', 400)
    }
    if (!(await getProject(body.projectId, viewer))) {
      return apiError('not_found', 'No project with that id.', 404)
    }
    projectId = body.projectId
  }

  const quota = await checkScanQuota(viewer)
  if (!quota.ok) return apiError('quota_exceeded', quota.reason, 429)

  const verdict = await checkApiScanAllowed({ userId: viewer.userId, targetHost: target.hostname })
  if (!verdict.ok) {
    return apiError('rate_limited', verdict.reason, 429, {
      'retry-after': String(verdict.retryAfterSeconds),
    })
  }

  const job = {
    url: target.url,
    profile: profile as ScanProfile,
    projectId,
    requestedBy: viewer.userId,
    // Null on purpose: this scan is attributed to an ACCOUNT, and storing a
    // hash of a CI runner's address alongside it would feed the per-address
    // limit that this path has already decided not to use.
    anonIpHash: null,
  }

  try {
    /*
     * A deep scan cannot finish inside a request, so it is reserved and
     * queued: 202 with a Location the caller polls. A fast one takes about two
     * seconds, so the request waits and the answer is already final: 201.
     * The status field says which happened, so a client that ignores the code
     * still behaves correctly.
     */
    if (profile === 'deep') {
      const scanId = await startScanJob(job)
      await inngest.send({ name: EVENTS.scanRequested, data: { scanId, ...job } })
      return NextResponse.json(
        { scan: { id: scanId, url: job.url, profile: 'deep', status: 'queued' }, links: { self: scanPath(scanId) } },
        { status: 202, headers: { location: scanPath(scanId) } },
      )
    }

    const scanId = await runScanJob(job)

    /*
     * The status is READ BACK rather than assumed. runScanJob does not throw
     * for a scan that failed — an SSRF-blocked target, a host that never
     * answered, a collapsed TLS handshake are all RESULTS — so it returns an
     * id either way. Reporting 'done' here would tell a pipeline its site
     * passed when the scan never reached it, which is the one lie a build
     * gate must never be told.
     */
    const scan = await getScanForViewer(scanId, viewer)
    return NextResponse.json(
      {
        scan: {
          id: scanId,
          url: job.url,
          profile: 'fast',
          status: scan?.status ?? 'done',
          error: scan?.error ?? null,
        },
        links: { self: scanPath(scanId) },
      },
      { status: 201, headers: { location: scanPath(scanId) } },
    )
  } catch (error) {
    // runScanJob records a FAILED scan itself and still returns an id, so
    // reaching here means something under it broke — the database, most
    // likely. The caller gets a code it can retry on; the detail goes to the log.
    console.error('[api/v1/scan] could not record the scan', error)
    return apiError('server_error', 'Could not start the scan. Try again in a moment.', 500)
  }
}
