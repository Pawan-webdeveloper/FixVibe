'use server'

import { revalidatePath } from 'next/cache'
import { getProject } from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'
import type { ScanProfile } from '@scanlyfix/db'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import { runScanJob, startScanJob } from '@/lib/scan/run-scan-job.ts'
import { redirect } from 'next/navigation'
import { checkScanQuota } from '@/lib/quota.ts'

/**
 * Re-scan a project.
 *
 * Ownership is re-checked here rather than trusted from the page that rendered
 * the button: a server action is reachable by anyone who can craft a POST, so
 * the projectId in the payload is a claim until getProject agrees with it.
 *
 * The scan itself goes through the same runScanJob the public endpoint uses.
 * One code path means a project scan and an anonymous scan can never disagree
 * about what a scan is.
 *
 * And it spends the same monthly allowance. A quota enforced only on the
 * public endpoint is a quota with a button next to it that skips the queue.
 * There is no error channel on a plain form action, so an exhausted allowance
 * comes back as a query parameter the page renders — silently doing nothing
 * would read as a broken button.
 *
 * Depth is chosen by which button was pressed. A deep scan crawls the site,
 * renders it in a real browser and reads field Core Web Vitals, so it is
 * queued rather than awaited and the caller is sent to the report to watch it.
 */
export async function rescanAction(formData: FormData): Promise<void> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') return

  const projectId = String(formData.get('projectId') ?? '')
  const project = await getProject(projectId, viewer)
  if (!project) return

  const quota = await checkScanQuota(viewer)
  if (!quota.ok) redirect(`/projects/${project.id}?quota=spent`)

  // Two submit buttons post to this one action. Anything that is not the deep
  // button is a fast scan — an unrecognised value must never become the
  // expensive path by accident.
  const profile: ScanProfile = formData.get('profile') === 'deep' ? 'deep' : 'fast'

  const job = { url: project.url, profile, projectId: project.id, requestedBy: viewer.userId }

  /*
   * A deep scan is closer to a minute than to a request, so it is reserved and
   * queued, and the caller is sent to the report to watch it arrive. A fast one
   * finishes here and the project page simply re-renders with it.
   */
  if (profile === 'deep') {
    const scanId = await startScanJob(job)
    await inngest.send({ name: EVENTS.scanRequested, data: { scanId, ...job } })
    redirect(`/scan/${scanId}`)
  }

  await runScanJob(job)
  revalidatePath(`/projects/${project.id}`)
}
