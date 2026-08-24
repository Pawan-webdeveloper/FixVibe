'use server'

import { revalidatePath } from 'next/cache'
import { getUserContext, setMonitor, type MonitorType } from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'
import { planFor } from '@/lib/plans.ts'

/**
 * Enabling a monitor is what starts spending money on somebody's behalf — a
 * probe every minute, forever — so the plan limit is enforced here rather than
 * only hidden in the UI. A server action is a public endpoint; the switch that
 * normally calls it proves nothing.
 */
export async function toggleMonitorAction(
  projectId: string,
  type: MonitorType,
  enabled: boolean,
): Promise<void> {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') return

  if (enabled) {
    const context = await getUserContext(viewer.userId)
    if (planFor(context?.plan).monitors === 0) return
  }

  await setMonitor(projectId, viewer, { type, enabled })
  revalidatePath(`/projects/${projectId}/monitors`)
}
