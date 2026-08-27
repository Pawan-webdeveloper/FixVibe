/**
 * GET /api/v1/scan/:id — read a scan, and poll a queued one.
 *
 *   curl https://scanlyfix.com/api/v1/scan/<id> -H 'Authorization: Bearer sf_…'
 *
 * One endpoint rather than two. A deep scan comes back 202 from POST and the
 * caller polls this until `status` leaves 'queued'/'running'; at that point the
 * same response already carries the whole report, so there is no second
 * request and no separate "results" resource that could disagree with the
 * status one.
 *
 * Findings go through redactFindings even though every plan that can reach
 * this endpoint today sees all of them. That is the point: the redaction rule
 * lives in one function, and routing around it "because Pro sees everything
 * anyway" is how a future tier with API access becomes the one door that hands
 * out the paid product. The API must never be the lenient path.
 */

import { NextResponse } from 'next/server'
import { getScanForViewer } from '@scanlyfix/db'
import { authenticateApiRequest } from '@/lib/api-auth.ts'
import { apiError } from '@/lib/api-response.ts'
import { entitlementsFor } from '@/lib/entitlements.ts'
import { canSeeFixPrompt, redactFindings } from '@/lib/redact.ts'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const auth = await authenticateApiRequest(request)
  if (!auth.ok) return apiError(auth.status === 401 ? 'unauthorized' : 'forbidden', auth.error, auth.status)

  const { scanId } = await params
  // Postgres answers a malformed uuid with an error rather than an empty set,
  // so the shape is checked before it reaches a query.
  if (!UUID.test(scanId)) return apiError('not_found', 'No scan with that id.', 404)

  const { viewer } = auth.principal
  const scan = await getScanForViewer(scanId, viewer)
  // getScanForViewer already answers null for another account's scan, so "not
  // yours" and "does not exist" are indistinguishable from out here — which is
  // what stops a key holder enumerating other accounts' scan ids.
  if (!scan) return apiError('not_found', 'No scan with that id.', 404)

  const entitlements = await entitlementsFor(viewer)
  const report = redactFindings(scan.findings, entitlements)

  return NextResponse.json({
    scan: {
      id: scan.id,
      url: scan.url,
      profile: scan.profile,
      status: scan.status,
      projectId: scan.projectId,
      createdAt: scan.createdAt.toISOString(),
      startedAt: scan.startedAt?.toISOString() ?? null,
      finishedAt: scan.finishedAt?.toISOString() ?? null,
      durationMs: scan.durationMs,
      /**
       * Both of these are comparability keys, not trivia. A caller charting
       * scores over time must refuse to compare across a change in either —
       * new checks legitimately lower a score for an unchanged site, and a
       * dashboard that misses that reports an outage nobody had.
       */
      engineVersion: scan.engineVersion,
      checksRun: scan.checksRun,
      /** Checks that crashed or timed out: OUR failures, not the site's. */
      checkErrors: scan.checkErrors,
      error: scan.error,
    },
    scores: scan.scores ?? null,
    context: scan.contextMeta ?? null,
    findings: report.findings,
    locked: { count: report.lockedCount, severities: report.lockedSeverities },
    // Advertised rather than assumed, so a client knows whether the aggregate
    // work order is missing because there was nothing to fix or because the
    // plan does not include it.
    fixPromptAvailable: canSeeFixPrompt(entitlements),
  })
}
