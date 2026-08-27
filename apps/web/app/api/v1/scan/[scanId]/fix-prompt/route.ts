/**
 * GET /api/v1/scan/:id/fix-prompt — the aggregate work order.
 *
 * Its own route rather than a field on the scan, for the same reason the web
 * app builds it at render time: the prompt is REBUILT from the stored findings
 * on every read, so its grouping and its stack-specific locations improve as
 * the engine does. A prompt frozen into the scan response would keep handing
 * out last month's advice, and most reads of a scan do not want a page of it.
 *
 * This is the endpoint an agent actually wants. Everything else here describes
 * a site; this one is the change list.
 */

import { NextResponse } from 'next/server'
import { buildFixPrompt } from '@scanlyfix/checks'
import { getScanForViewer } from '@scanlyfix/db'
import { authenticateApiRequest } from '@/lib/api-auth.ts'
import { apiError } from '@/lib/api-response.ts'
import { entitlementsFor } from '@/lib/entitlements.ts'
import { canSeeFixPrompt } from '@/lib/redact.ts'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const auth = await authenticateApiRequest(request)
  if (!auth.ok) return apiError(auth.status === 401 ? 'unauthorized' : 'forbidden', auth.error, auth.status)

  const { scanId } = await params
  if (!UUID.test(scanId)) return apiError('not_found', 'No scan with that id.', 404)

  const { viewer } = auth.principal
  const scan = await getScanForViewer(scanId, viewer)
  if (!scan) return apiError('not_found', 'No scan with that id.', 404)

  const entitlements = await entitlementsFor(viewer)
  // Withheld whole rather than truncated. An agent handed half a work order
  // makes half the changes and reports success — which is worse than being
  // told it cannot have one.
  if (!canSeeFixPrompt(entitlements)) {
    return apiError('forbidden', `The ${entitlements.plan.name} plan does not include the aggregate fix prompt.`, 403)
  }

  const prompt = buildFixPrompt(scan.findings, {
    url: scan.contextMeta?.finalUrl ?? scan.url,
    stack: {
      framework: scan.contextMeta?.framework ?? null,
      // Absent on scans recorded before platform detection existed; null is
      // the honest value, and the prompt falls back to generic guidance.
      platform: scan.contextMeta?.platform ?? null,
    },
  })

  const actionable = scan.findings.filter((f) => f.severity !== 'info').length

  return NextResponse.json({
    scanId: scan.id,
    url: scan.url,
    /**
     * Empty string when nothing is actionable, and that is a real answer
     * rather than an error: a report of only informational rows has no work
     * order. `issueCount` says which of the two happened.
     */
    prompt,
    issueCount: actionable,
  })
}
