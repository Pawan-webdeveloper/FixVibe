/**
 * Alert delivery, deduplicated at the write.
 *
 * The dedup is the entire reason this file exists rather than each cron job
 * inserting its own row. A flapping site produces a failure every minute, and
 * without a guard here that is forty emails overnight — after which the
 * customer cancels the product, not the alert. Deduplicating at each caller
 * would mean getting it right in four places instead of one.
 *
 * The window is a calendar day per (project, kind). Coarse on purpose: an
 * hourly limit still lets a bad night produce a dozen messages, and nobody
 * needs to be told twice in a day that the same thing is still broken.
 */

import { and, desc, eq, gte } from 'drizzle-orm'
import { db } from '../client.ts'
import { alerts, type Alert } from '../schema.ts'
import { getProject } from './projects.ts'
import type { Viewer } from './viewer.ts'

export type AlertChannel = Alert['channel']

/**
 * Returns the row when this is the first alert of its kind today, and null when
 * one already went out.
 *
 * A race between two workers can still produce two rows — the check and the
 * insert are not atomic. That is accepted: the cost is one duplicate email in a
 * rare case, and the alternative is a partial unique index on a date expression
 * plus a migration, for a guarantee nobody would notice.
 */
export async function recordAlertOnce(input: {
  projectId: string
  kind: string
  channel: AlertChannel
  payload: Record<string, unknown>
}): Promise<Alert | null> {
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)

  const existing = await db.query.alerts.findFirst({
    where: and(
      eq(alerts.projectId, input.projectId),
      eq(alerts.kind, input.kind),
      gte(alerts.createdAt, startOfDay),
    ),
    columns: { id: true },
  })
  if (existing) return null

  const [row] = await db
    .insert(alerts)
    .values({
      projectId: input.projectId,
      kind: input.kind,
      channel: input.channel,
      payload: input.payload,
    })
    .returning()

  return row ?? null
}

/** Marks an alert as actually delivered, so an unsent one is visible as such. */
export async function markAlertSent(alertId: string): Promise<void> {
  await db.update(alerts).set({ sentAt: new Date() }).where(eq(alerts.id, alertId))
}

export async function listAlerts(projectId: string, viewer: Viewer, limit = 50): Promise<Alert[]> {
  if (!(await getProject(projectId, viewer))) return []
  return db.query.alerts.findMany({
    where: eq(alerts.projectId, projectId),
    orderBy: desc(alerts.createdAt),
    limit,
  })
}
