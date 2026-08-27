/**
 * A report, emailed as a file.
 *
 * The download route already answers CSV and Markdown in milliseconds and a
 * PDF in a couple of seconds, so this job is NOT how a person gets a report —
 * clicking a link and waiting for a queue would be a worse product. What it is
 * for is the deliveries nobody is sitting in front of:
 *
 *   - a scheduled re-scan that should land in an inbox on Monday morning
 *   - a report requested when the browser tier is busy or temporarily down,
 *     where a queue's retries turn a 503 into a delivery instead of an error
 *
 * That is also why the file is ATTACHED rather than linked. A link would need
 * somewhere to put the file, and Supabase Storage needs a service-role key
 * this deployment does not have — so the report travels with the message and
 * the `reports` table stays unused until there is a bucket to point it at.
 *
 * The PDF step is separate from the send step deliberately. Inngest memoizes
 * completed steps, so a mail provider hiccup retries the SEND without paying
 * for the browser render a second time.
 */

import { getScanForViewer, getUserContext } from '@scanlyfix/db'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import { entitlementsFor } from '@/lib/entitlements.ts'
import { redactFindings } from '@/lib/redact.ts'
import { sendEmail } from '@/lib/email.ts'
import { buildCsv, buildHtml, buildMarkdown, filename, type ReportInput } from '@/lib/report/build.ts'
import { renderReportPdf } from '@/lib/report/pdf.ts'

export interface ReportRequestedEvent {
  scanId: string
  /** Whose entitlements decide what the file contains. Never inferred from the scan. */
  userId: string
  format: 'csv' | 'md' | 'pdf'
}

const CONTENT_TYPE = {
  csv: 'text/csv',
  md: 'text/markdown',
  pdf: 'application/pdf',
} as const

export const generateReport = inngest.createFunction(
  {
    id: 'generate-report',
    triggers: [{ event: EVENTS.reportRequested }],
    /**
     * A PDF holds a browser context on a service that runs two at a time. More
     * of them in flight just queues inside the scanner and times out there,
     * where the failure has no retry behind it.
     */
    concurrency: { limit: 2 },
    retries: 3,
  },
  async ({ event, step }) => {
    const { scanId, userId, format } = event.data as ReportRequestedEvent

    const built = await step.run('build', async () => {
      const viewer = { kind: 'user', userId } as const

      // Re-read rather than trusting the event. An event is a message, not an
      // authorization: by the time this runs the scan may have been deleted,
      // or the account's plan may have lapsed, and the file must reflect what
      // is true NOW rather than what was true when the button was pressed.
      const scan = await getScanForViewer(scanId, viewer)
      if (!scan) return { ok: false as const, reason: 'scan not found or not this account’s' }

      const entitlements = await entitlementsFor(viewer)
      if (!entitlements.plan.exports) return { ok: false as const, reason: 'plan does not include exports' }

      const account = await getUserContext(userId)
      if (!account) return { ok: false as const, reason: 'no account row' }

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

      return {
        ok: true as const,
        email: account.email,
        url: scan.url,
        name: filename(input.scan, format),
        // The text formats are finished here; the PDF needs a browser and gets
        // its own step so a retry does not re-render it.
        body: format === 'pdf' ? null : format === 'csv' ? buildCsv(input) : buildMarkdown(input),
        html: format === 'pdf' ? buildHtml(input) : null,
      }
    })

    if (!built.ok) return { delivered: false, reason: built.reason }

    const base64 = await step.run('render', async () => {
      if (built.body !== null) return Buffer.from(built.body, 'utf8').toString('base64')

      const result = await renderReportPdf(built.html!)
      if (result.ok) return result.pdf.toString('base64')

      // Retryable failures are THROWN so the queue tries again — a busy
      // scanner is the normal case this job exists to absorb. A deployment
      // with no browser tier is not retryable and must not burn three attempts
      // discovering that, so it returns and the job reports why.
      if (result.retryable) throw new Error(`[generate-report] ${result.reason}`)
      return null
    })

    if (base64 === null) {
      return { delivered: false, reason: 'PDF export is not configured on this deployment' }
    }

    const sent = await step.run('send', () =>
      sendEmail({
        to: built.email,
        subject: `ScanlyFix report — ${built.url}`,
        text:
          `Your ScanlyFix report for ${built.url} is attached as ${built.name}.\n\n` +
          'It reflects the scan at the moment it was generated; re-run the scan for a current reading.',
        attachments: [{ filename: built.name, contentBase64: base64, contentType: CONTENT_TYPE[format] }],
      }),
    )

    return { delivered: sent.sent, ...(sent.sent ? { id: sent.id } : { reason: sent.reason }) }
  },
)
