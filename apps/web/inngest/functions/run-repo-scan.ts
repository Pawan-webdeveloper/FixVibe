/**
 * A repo scan, on the queue.
 *
 * Direct parallel of run-scan.ts. The Inngest function reserves nothing on
 * its own — the row was created at the API edge so the caller had an id to
 * poll, and this function just fills it in by calling executeRepoScan. That
 * means a retry re-runs the same scan, not a second one of the same repo,
 * which is the whole point of the reserve/execute split.
 */

import type { RepoScanProfile } from '@scanlyfix/db'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import { executeRepoScan, type RepoScanRequest } from '@/lib/scan/run-repo-scan-job.ts'

export interface RepoScanRequestedEvent {
  repoScanId: string
  repoId: string
  installationId: number
  owner: string
  name: string
  defaultBranch: string
  profile: RepoScanProfile
  requestedBy?: string | null
}

export const runRepoScanQueued = inngest.createFunction(
  {
    id: 'run-repo-scan',
    triggers: [{ event: EVENTS.repoScanRequested }],
    /**
     * A deep scan clones a repo and runs gitleaks + osv-scanner. Two at a
     * time is what one github-scanner container survives; more is a self-
     * inflicted outage and an unwelcome clone against repos we did not ask
     * to be told about.
     */
    concurrency: { limit: 2 },
    retries: 1,
  },
  async ({ event, step }) => {
    const data = event.data as RepoScanRequestedEvent

    await step.run('scan', () =>
      executeRepoScan(data.repoScanId, {
        repoId: data.repoId,
        installationId: data.installationId,
        owner: data.owner,
        name: data.name,
        defaultBranch: data.defaultBranch,
        profile: data.profile,
        requestedBy: data.requestedBy ?? null,
      } satisfies RepoScanRequest),
    )

    return { repoScanId: data.repoScanId }
  },
)
