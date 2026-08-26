/**
 * A scan, on the queue.
 *
 * This is how the deep profile runs: a crawl plus PageSpeed plus a browser
 * render is closer to a minute than to a request, so the endpoint RESERVES the
 * row, hands the id back immediately, and this function fills it in.
 *
 * `scanId` arrives in the event rather than being created here, and that is
 * the whole point. If this function created the row, the caller would have
 * nothing to redirect to and nothing to poll — and a retry would create a
 * second scan of the same site rather than re-running the first.
 *
 * Idempotent through executeScan, whose completeScan clears a scan's findings
 * before writing them. Inngest retries by design, and without that a retry
 * would double every finding and halve the site's apparent score.
 */

import type { ScanProfile } from '@darvin/db'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import { executeScan } from '@/lib/scan/run-scan-job.ts'

export interface ScanRequestedEvent {
  scanId: string
  url: string
  profile: ScanProfile
  projectId?: string | null
  requestedBy?: string | null
  anonIpHash?: string | null
}

export const runScanQueued = inngest.createFunction(
  {
    id: 'run-scan',
    triggers: [{ event: EVENTS.scanRequested }],
    /**
     * A deep scan holds a browser context and crawls somebody else's site.
     * Four at a time is what a single scanner container survives; more of them
     * is a self-inflicted outage and an unwelcome visit for every target.
     */
    concurrency: { limit: 4 },
    retries: 2,
  },
  async ({ event, step }) => {
    const data = event.data as ScanRequestedEvent

    await step.run('scan', () =>
      executeScan(data.scanId, {
        url: data.url,
        profile: data.profile,
        projectId: data.projectId ?? null,
        requestedBy: data.requestedBy ?? null,
        anonIpHash: data.anonIpHash ?? null,
      }),
    )

    return { scanId: data.scanId }
  },
)
