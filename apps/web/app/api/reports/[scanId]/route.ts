/**
 * GET /api/reports/:scanId?format=csv|md|pdf — download a scan as a file.
 *
 * ## Two ways in, one authorization
 *
 * This is the one route that answers BOTH a browser session and an API key.
 * A download is started by a link the person clicks, which cannot set an
 * Authorization header — so unlike /api/v1, the session has to work here. And
 * a CI job that wants the CSV has no session, so the key has to work too.
 *
 * The Authorization header is tried FIRST and the cookie only if there is
 * none. That ordering is what keeps this from being a CSRF hole in the way
 * /api/v1 refuses to be: this endpoint is GET-only and side-effect free, so a
 * cross-origin request forged against it can at worst make a browser download
 * a file its owner could already read.
 *
 * ## Redaction is not skipped
 *
 * The findings go through redactFindings before any formatter sees them, for
 * the same reason the API does it: an export must never be the lenient door.
 * A locked finding is written into the file as locked, so the file is never
 * silently short.
 */

import { getScanForViewer, resolveApiKey, type Viewer } from '@darvin/db'
import { bearerToken } from '@/lib/api-auth.ts'
import { apiError } from '@/lib/api-response.ts'
import { getViewer } from '@/lib/authz.ts'
import { entitlementsFor } from '@/lib/entitlements.ts'
import { redactFindings } from '@/lib/redact.ts'
import { buildCsv, buildHtml, buildMarkdown, filename, type ReportInput } from '@/lib/report/build.ts'
import { renderReportPdf } from '@/lib/report/pdf.ts'

export const runtime = 'nodejs'
/** A PDF is a browser render on another machine; the rest are milliseconds. */
export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const FORMATS = {
  csv: { extension: 'csv', contentType: 'text/csv; charset=utf-8' },
  md: { extension: 'md', contentType: 'text/markdown; charset=utf-8' },
  pdf: { extension: 'pdf', contentType: 'application/pdf' },
} as const

type Format = keyof typeof FORMATS

export async function GET(request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params
  if (!UUID.test(scanId)) return apiError('not_found', 'No scan with that id.', 404)

  const format = new URL(request.url).searchParams.get('format') ?? 'pdf'
  if (!(format in FORMATS)) {
    return apiError('invalid_request', `Unknown format. Use one of: ${Object.keys(FORMATS).join(', ')}.`, 400)
  }
  const { extension, contentType } = FORMATS[format as Format]

  /*
   * The key is resolved directly rather than through authenticateApiRequest,
   * and the difference is not cosmetic: that function also enforces
   * `plan.apiAccess`, which is the entitlement for /api/v1 and not the one
   * this route sells. Routing through it coupled two unrelated gates — a plan
   * with exports but no API access would have been refused its own downloads,
   * and a Free key was told its key was invalid when the key was fine and the
   * plan was not.
   *
   * `plan.exports` below is the only entitlement this route checks.
   */
  const token = bearerToken(request.headers)
  let viewer: Viewer
  if (token) {
    const resolved = await resolveApiKey(token)
    if (!resolved) return apiError('unauthorized', 'That key is not valid. Check it, or issue a new one.', 401)
    viewer = { kind: 'user', userId: resolved.userId }
  } else {
    viewer = await getViewer()
  }

  if (viewer.kind !== 'user') return apiError('unauthorized', 'Sign in to download a report.', 401)

  const entitlements = await entitlementsFor(viewer)
  if (!entitlements.plan.exports) {
    return apiError('forbidden', `The ${entitlements.plan.name} plan does not include report exports.`, 403)
  }

  const scan = await getScanForViewer(scanId, viewer)
  // Same answer for "not yours" as for "does not exist" — anything else lets a
  // signed-in stranger enumerate other accounts' scan ids.
  if (!scan) return apiError('not_found', 'No scan with that id.', 404)

  const redacted = redactFindings(scan.findings, entitlements)
  const input: ReportInput = {
    scan: {
      id: scan.id,
      url: scan.url,
      profile: scan.profile,
      status: scan.status,
      createdAt: scan.createdAt,
      finishedAt: scan.finishedAt,
      durationMs: scan.durationMs,
      engineVersion: scan.engineVersion,
      checksRun: scan.checksRun,
      checkErrors: scan.checkErrors,
      scores: scan.scores ?? null,
      contextMeta: scan.contextMeta ?? null,
    },
    findings: redacted.findings,
    lockedCount: redacted.lockedCount,
  }

  const name = filename(input.scan, extension)

  if (format === 'pdf') {
    const result = await renderReportPdf(buildHtml(input))
    if (!result.ok) {
      // 503 when a retry could work, 501 when the deployment simply has no
      // browser tier — a client that cannot tell those apart either retries
      // forever or gives up on a transient failure.
      return apiError('server_error', result.reason, result.retryable ? 503 : 501)
    }
    return file(result.pdf, contentType, name)
  }

  const body = format === 'csv' ? buildCsv(input) : buildMarkdown(input)
  return file(Buffer.from(body, 'utf8'), contentType, name)
}

/**
 * `attachment` rather than `inline`, for every format including PDF.
 *
 * A report holds a scanned site's own markup quoted back as evidence. Served
 * inline it would render in the browser on OUR origin, which turns an export
 * into stored XSS against the app. `nosniff` closes the other half of that:
 * without it a CSV whose first bytes look like HTML gets sniffed and rendered
 * anyway, whatever the content type says.
 */
function file(body: Buffer, contentType: string, name: string): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': contentType,
      'content-disposition': `attachment; filename="${name}"`,
      'content-length': String(body.byteLength),
      'x-content-type-options': 'nosniff',
      // A report is a snapshot of one scan and never changes, but it is also
      // private — so it may be reused by this browser and by nothing else.
      'cache-control': 'private, max-age=3600',
    },
  })
}
