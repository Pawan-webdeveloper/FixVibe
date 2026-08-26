'use server'

import { revalidatePath } from 'next/cache'
import { getProject } from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'
import { runScanJob } from '@/lib/scan/run-scan-job.ts'

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
 */
export async function rescanAction(formData: FormData): Promise<void> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') return

  const projectId = String(formData.get('projectId') ?? '')
  const project = await getProject(projectId, viewer)
  if (!project) return

  await runScanJob({
    url: project.url,
    profile: 'fast',
    projectId: project.id,
    requestedBy: viewer.userId,
  })

  revalidatePath(`/projects/${project.id}`)
}
