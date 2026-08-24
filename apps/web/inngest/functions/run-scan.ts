/**
 * A scan, on the queue.
 *
 * Unused while every scan finishes inline in about two seconds. It exists for
 * the deep profile — a browser render plus a crawl plus PageSpeed is closer to
 * a minute, which no request can wait for — and because having it now means the
 * scan route can switch to enqueueing by changing which line it calls.
 *
 * Idempotent through runScanJob, whose completeScan clears a scan's findings
 * before writing them. Inngest retries by design, and without that a retry
 * would double every finding and halve the site's apparent score.
 */

import type { ScanProfile } from '@darvin/db'
import { inngest } from '@/lib/inngest.ts'
import { runScanJob } from '@/lib/scan/run-scan-job.ts'

export const runScanQueued = inngest.createFunction(
  { id: 'run-scan', triggers: [{ event: 'darvin/scan.requested' }], concurrency: { limit: 8 }, retries: 2 },
  async ({ event, step }) => {
    const data = event.data as {
      url: string
      profile: ScanProfile
      projectId?: string | null
      requestedBy?: string | null
      anonIpHash?: string | null
    }

    const scanId = await step.run('scan', () =>
      runScanJob({
        url: data.url,
        profile: data.profile,
        projectId: data.projectId ?? null,
        requestedBy: data.requestedBy ?? null,
        anonIpHash: data.anonIpHash ?? null,
      }),
    )

    return { scanId }
  },
)
