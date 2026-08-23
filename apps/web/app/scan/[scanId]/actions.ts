'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { claimScan, getUserContext } from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'

/**
 * Turn a shared report into a project the viewer owns.
 *
 * This is the conversion moment: someone scanned a URL, liked what came back,
 * and signed up. Without this they land in an empty dashboard and the report
 * that convinced them is just a link they have to keep somewhere.
 *
 * Only genuinely anonymous scans can be claimed, and claimScan enforces that in
 * the UPDATE itself rather than here — two people opening the same shared link
 * cannot both take it.
 */
export async function claimScanAction(formData: FormData): Promise<void> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') return

  const scanId = String(formData.get('scanId') ?? '')
  const context = await getUserContext(viewer.userId)
  if (!context) return

  const claimed = await claimScan(scanId, viewer, context.orgId)
  if (!claimed) {
    // Already owned by someone, or no longer anonymous. Re-render rather than
    // erroring: the report itself is still perfectly readable.
    revalidatePath(`/scan/${scanId}`)
    return
  }

  redirect(`/projects/${claimed.projectId}`)
}
