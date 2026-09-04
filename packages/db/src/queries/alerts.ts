/**
 * Alert delivery, deduplicated at the write.
 *
 * The dedup is the entire reason this file exists rather than each cron job
 * inserting its own row. A flapping site produces a failure every minute, and
 * without a guard here that is forty emails overnight — after which the
 * customer cancels the product, not the alert. Deduplicating at each caller
 * would mean getting it right in four places instead of one.
 *
 * Dedup strategy:
 *   - State-transition alerts (downtime, recovered): NO daily dedup
 *     These represent UP→DOWN or DOWN→UP transitions that the user must know.
 *   - Reminder alerts: dedup by dedupKey (e.g., "downtime-{monitorId}-{incidentId}-reminder-{slot}")
 *     Prevents duplicate reminder emails within the same time slot.
 *   - Other alerts (certificate-expiry-*, dns-drift, web_vitals, score-drop):
 *     Daily dedup per (project, kind). Coarse on purpose.
 */

import { and, desc, eq, gte, isNull } from 'drizzle-orm'
import { db } from '../client.ts'
import { alerts, projects, users, type Alert } from '../schema.ts'
import { getProject } from './projects.ts'
import type { Viewer } from './viewer.ts'

export type AlertChannel = Alert['channel']
export type { AlertChannelName } from './alert-channels.ts'

/** Alert kinds that are exempt from daily dedup (state transition events) */
const DEDUP_EXEMPT_KINDS = new Set(['downtime', 'recovered'])

/**
 * Returns the row when this is the first alert of its kind today, and null when
 * one already went out.
 *
 * Dedup logic:
 *   - If dedupKey is provided: check for existing alert with same dedupKey
 *   - If dedupKey is null and kind is in DEDUP_EXEMPT_KINDS: always create (no dedup)
 *   - If dedupKey is null and kind is NOT in DEDUP_EXEMPT_KINDS: daily dedup by (project, kind)
 */
export async function recordAlertOnce(input: {
  projectId: string
  kind: string
  channel: AlertChannel
  payload: Record<string, unknown>
  dedupKey?: string | null
}): Promise<Alert | null> {
  // State-transition alerts (downtime, recovered) are exempt from daily dedup
  // when no dedupKey is provided
  if (!input.dedupKey && DEDUP_EXEMPT_KINDS.has(input.kind)) {
    // Always create — no dedup for state transitions without dedupKey
  } else if (input.dedupKey) {
    // Reminder alerts: dedup by dedupKey
    const existing = await db.query.alerts.findFirst({
      where: eq(alerts.dedupKey, input.dedupKey),
      columns: { id: true },
    })
    if (existing) return null
  } else {
    // Other alerts: daily dedup by (project, kind)
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
  }

  const [row] = await db
    .insert(alerts)
    .values({
      projectId: input.projectId,
      kind: input.kind,
      channel: input.channel,
      payload: input.payload,
      dedupKey: input.dedupKey ?? null,
    })
    .returning()

  return row ?? null
}

/**
 * Everything needed to send one alert, in a single query.
 *
 * The alert ROW is the source of truth for what to send — its kind and payload
 * already describe the event — so delivery does not need the job that raised
 * it to hand anything along. That is what lets a failed send be retried later
 * from nothing but an id.
 *
 * The recipient is the project's OWNER. Memberships exist in the schema and
 * team alerting will need them, but sending to a list nobody has chosen yet
 * would be inventing a feature; one address is the honest answer today.
 */
export interface AlertForDelivery {
  id: string
  kind: string
  projectId: string
  payload: Record<string, unknown> | null
  sentAt: Date | null
  projectName: string
  projectUrl: string
  projectSlug: string
  recipientEmail: string
}

export async function alertForDelivery(alertId: string): Promise<AlertForDelivery | null> {
  const [row] = await db
    .select({
      id: alerts.id,
      kind: alerts.kind,
      projectId: alerts.projectId,
      payload: alerts.payload,
      sentAt: alerts.sentAt,
      projectName: projects.name,
      projectUrl: projects.url,
      projectSlug: projects.slug,
      recipientEmail: users.email,
    })
    .from(alerts)
    .innerJoin(projects, eq(projects.id, alerts.projectId))
    .innerJoin(users, eq(users.id, projects.ownerId))
    .where(eq(alerts.id, alertId))
    .limit(1)

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
