/**
 * Printing a report.
 *
 * WHICH PDF LIBRARY: none. The browser tier in apps/scanner already runs a
 * headless Chromium for the audit jobs, so the report is printed by the same
 * engine that renders it on screen — real text shaping, real table layout, and
 * page breaks controlled by the CSS the print stylesheet already defines. A
 * Node PDF library would mean a second layout engine, its own font handling,
 * and a document that looks nothing like the product.
 *
 * The cost of that choice is honest and stated: PDF needs the scanner service.
 * When it is not configured this returns a reason rather than a file, and the
 * route turns that into a sentence naming the two variables — because a
 * download button that produces a 500 teaches nobody anything.
 *
 * CSV and Markdown deliberately do NOT go through here. They are strings, they
 * are generated in the request, and they must keep working on a deployment
 * that has no browser tier at all.
 */

import 'server-only'

const SCANNER_URL = process.env['DARVIN_SCANNER_URL']
const SCANNER_TOKEN = process.env['DARVIN_SCANNER_TOKEN']

/** A one-page document should take a second or two; past this it is wedged. */
const TIMEOUT_MS = 45_000

export type PdfResult =
  | { readonly ok: true; readonly pdf: Buffer }
  | { readonly ok: false; readonly reason: string; readonly retryable: boolean }

export function pdfConfigured(): boolean {
  return Boolean(SCANNER_URL && SCANNER_TOKEN)
}

export async function renderReportPdf(html: string): Promise<PdfResult> {
  if (!SCANNER_URL || !SCANNER_TOKEN) {
    return {
      ok: false,
      retryable: false,
      reason:
        'PDF export needs the browser tier. Set DARVIN_SCANNER_URL and DARVIN_SCANNER_TOKEN, ' +
        'and run apps/scanner. CSV and Markdown work without it.',
    }
  }

  let response: Response
  try {
    response = await fetch(`${SCANNER_URL.replace(/\/+$/, '')}/pdf`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SCANNER_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ html }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    // The service is down or unreachable. Retryable, so a queued job retries
    // rather than recording a permanent failure for something transient.
    return {
      ok: false,
      retryable: true,
      reason: `Could not reach the browser tier: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (!response.ok) {
    // 503 is the scanner's "busy" — two renders at a time is its ceiling, and
    // a third caller should come back rather than be told the report failed.
    const retryable = response.status === 503 || response.status >= 500
    return { ok: false, retryable, reason: `The browser tier answered ${response.status}.` }
  }

  const body = (await response.json().catch(() => null)) as { pdfBase64?: unknown } | null
  if (!body || typeof body.pdfBase64 !== 'string') {
    return { ok: false, retryable: false, reason: 'The browser tier returned no document.' }
  }

  return { ok: true, pdf: Buffer.from(body.pdfBase64, 'base64') }
}
