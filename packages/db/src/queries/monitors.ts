/**
 * Monitors and the events they produce.
 *
 * Same Viewer rule as everywhere else, with ONE deliberate exception:
 * `dueMonitorsForScheduler` takes no Viewer and returns rows across every
 * account. It has to — it runs from a cron with nobody signed in, and its whole
 * job is "what is due, anywhere". The name says so rather than hiding it behind
 * a neutral one, because an unfiltered query that reads like a normal one is
 * how the exception becomes the rule.
 */

import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm' /* uptime error — was missing gte, caused ReferenceError at runtime in getUptime() */
import { db } from '../client.ts'
import { incidents, monitorEvents, monitors, projects, scans, type Incident, type Monitor, type MonitorEvent } from '../schema.ts' /* monitor error — added missing Incident type import */
import { getProject } from './projects.ts'
import type { Viewer } from './viewer.ts'

export type MonitorType = Monitor['type']

export async function listMonitors(projectId: string, viewer: Viewer): Promise<Monitor[]> {
  if (!(await getProject(projectId, viewer))) return []
  return db.query.monitors.findMany({ where: eq(monitors.projectId, projectId), orderBy: asc(monitors.type) })
}

/**
 * One monitor per (project, type) — the schema enforces it with a unique index,
 * so this upserts rather than risking a second row for the same job.
 */
export async function setMonitor(
  projectId: string,
  viewer: Viewer,
  input: { type: MonitorType; enabled: boolean; intervalS?: number },
): Promise<Monitor | null> {
  if (!(await getProject(projectId, viewer))) return null

  const [row] = await db
    .insert(monitors)
    .values({
      projectId,
      type: input.type,
      enabled: input.enabled,
      ...(input.intervalS === undefined ? {} : { intervalS: input.intervalS }),
    })
    .onConflictDoUpdate({
      target: [monitors.projectId, monitors.type],
      set: {
        enabled: input.enabled,
        ...(input.intervalS === undefined ? {} : { intervalS: input.intervalS }),
      },
    })
    .returning()

  return row ?? null
}

export interface DueMonitor {
  id: string
  type: MonitorType
  projectId: string
  projectUrl: string
  projectSlug: string
  /** Who the alert belongs to. Carried here so a job needs no second lookup. */
  ownerId: string
}

/**
 * SYSTEM QUERY — no Viewer, every account. See the file header.
 *
 * Due means enabled and never run, or enabled and last run longer ago than its
 * own interval. Computed in SQL rather than by fetching everything and
 * filtering in Node: at a thousand monitors the difference is a scan of the
 * index versus a scan of the table, every minute, forever.
 */
export async function dueMonitorsForScheduler(limit = 500): Promise<DueMonitor[]> {
  return db
    .select({
      id: monitors.id,
      type: monitors.type,
      projectId: monitors.projectId,
      projectUrl: projects.url,
      projectSlug: projects.slug,
      ownerId: projects.ownerId,
    })
    .from(monitors)
    .innerJoin(projects, eq(projects.id, monitors.projectId))
    .where(
      and(
        eq(monitors.enabled, true),
        or(
          isNull(monitors.lastRunAt),
          lte(monitors.lastRunAt, sql`now() - make_interval(secs => ${monitors.intervalS})`),
        ),
      ),
    )
    // Longest-waiting first, so a backlog drains fairly instead of starving
    // whichever monitor happens to sort last.
    .orderBy(asc(sql`coalesce(${monitors.lastRunAt}, 'epoch'::timestamptz)`))
    .limit(limit)
}

export interface MonitorOutcome {
  ok: boolean
  statusCode?: number | null
  latencyMs?: number | null
  detail?: string | null
}

/**
 * Records what happened and marks the monitor run, in one transaction — a
 * monitor whose lastRunAt advanced without an event would silently skip its
 * next turn, and one with an event but no lastRunAt would run again immediately.
 */
export async function recordMonitorRun(monitorId: string, outcome: MonitorOutcome): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(monitorEvents).values({
      monitorId,
      ok: outcome.ok,
      statusCode: outcome.statusCode ?? null,
      latencyMs: outcome.latencyMs ?? null,
      detail: outcome.detail ?? null,
    })
    await tx
      .update(monitors)
      .set({ lastRunAt: new Date(), lastStatus: outcome.ok ? 'up' : 'down' }) /* uptime error — use 'up'/'down' to match monitorTypeEnum semantics and UI checks */
      .where(eq(monitors.id, monitorId))
  })
}

export async function recentEvents(monitorId: string, viewer: Viewer, limit = 90): Promise<MonitorEvent[]> {
  const monitor = await db.query.monitors.findFirst({
    where: eq(monitors.id, monitorId),
    columns: { projectId: true },
  })
  if (!monitor || !(await getProject(monitor.projectId, viewer))) return []

  return db.query.monitorEvents.findMany({
    where: eq(monitorEvents.monitorId, monitorId),
    orderBy: desc(monitorEvents.ts),
    limit,
  })
}

/**
 * How many runs in a row have failed, newest first.
 *
 * The alerting rule is built on this: one failure is noise — a timeout, a
 * deploy, a blip — and a monitoring product that emails about it teaches people
 * to filter it. Two in a row is a site that is actually down.
 */
export async function consecutiveFailures(monitorId: string, look = 5): Promise<number> {
  const events = await db.query.monitorEvents.findMany({
    where: eq(monitorEvents.monitorId, monitorId),
    orderBy: desc(monitorEvents.ts),
    limit: look,
    columns: { ok: true },
  })

  let streak = 0
  for (const event of events) {
    if (event.ok) break
    streak += 1
  }
  return streak
}

/**
 * SYSTEM QUERY — no Viewer. A monitor job comparing this run to the last one is
 * reading scans it just caused, for a project the scheduler already resolved.
 * Threading a synthetic viewer through would look like authorization while
 * proving nothing; naming it for what it is keeps the exception visible.
 */
export async function recentScansForScheduler(projectId: string, limit = 2) {
  return db.query.scans.findMany({
    where: eq(scans.projectId, projectId),
    orderBy: desc(scans.createdAt),
    limit,
  })
}

/**
 * Opens a new incident for a monitor.
 *
 * Called only when recordAlertOnce returns a fresh alert — so if the alert
 * deduplicates, the incident does too. One alert, one incident, always in sync.
 */
export async function createIncident(
  monitorId: string,
  meta: { statusCode?: number | null; detail?: string | null },
): Promise<void> {
  await db.insert(incidents).values({
    monitorId,
    startedAt: new Date(),
    statusCode: meta.statusCode ?? null,
    detail: meta.detail ?? null,
  })
}

/**
 * Resolves the most recent open incident for a monitor.
 *
 * Called as soon as a probe comes back ok — recovery is immediate, no streak
 * needed. If no open incident exists this is a no-op, so it is safe to call
 * on every successful check.
 */
export async function resolveIncident(monitorId: string): Promise<void> {
  const open = await db.query.incidents.findFirst({
    where: and(
      eq(incidents.monitorId, monitorId),
      isNull(incidents.resolvedAt),
    ),
    orderBy: desc(incidents.startedAt),
  })

  if (!open) return

  const durationMs = Date.now() - open.startedAt.getTime()

  await db
    .update(incidents)
    .set({ resolvedAt: new Date(), durationMs })
    .where(eq(incidents.id, open.id))
}




/* -------------------------------------------------------------------------- */
/* Phase 5 — Dashboard queries                                                 */
/* -------------------------------------------------------------------------- */

 
/**
 * All monitors across every project owned by the viewer.
 * Used on the main dashboard to show a single unified list.
 */
export async function listMonitorsForUser(
  viewer: Viewer,
): Promise<Array<Monitor & { projectUrl: string; projectName: string }>> {
  /* monitor error — Viewer is a union type; userId only exists on kind: 'user'.
   * Must check kind before accessing userId to satisfy TypeScript. */
  if (viewer.kind !== 'user') return []
 
  return db
    .select({
      id: monitors.id,
      type: monitors.type,
      projectId: monitors.projectId,
      enabled: monitors.enabled,
      intervalS: monitors.intervalS,
      lastRunAt: monitors.lastRunAt,
      lastStatus: monitors.lastStatus,
      createdAt: monitors.createdAt,
      projectUrl: projects.url,
      projectName: projects.name,
    })
    .from(monitors)
    .innerJoin(projects, eq(projects.id, monitors.projectId))
    .where(eq(projects.ownerId, viewer.userId))
    .orderBy(desc(monitors.createdAt)) as Promise<Array<Monitor & { projectUrl: string; projectName: string }>>
}




/**
 * Uptime percentage for a monitor over a given period.
 *
 * Returns 100% when no events exist — a monitor that has never run is not
 * down, it just has not been checked yet.
 */
export async function getUptime(
  monitorId: string,
  viewer: Viewer,
  period: '24h' | '7d' | '30d',
): Promise<{ total: number; up: number; down: number; uptimePercent: number }> {
  const monitor = await db.query.monitors.findFirst({
    where: eq(monitors.id, monitorId),
    columns: { projectId: true },
  })
  if (!monitor || !(await getProject(monitor.projectId, viewer))) {
    return { total: 0, up: 0, down: 0, uptimePercent: 100 }
  }
 
  const intervalMap = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' } as const
 
  const [result] = await db
    .select({
      total: sql<number>`count(*)::int`,
      up: sql<number>`count(*) filter (where ${monitorEvents.ok})::int`,
    })
    .from(monitorEvents)
    .where(
      and(
        eq(monitorEvents.monitorId, monitorId),
        gte(monitorEvents.ts, sql`now() - interval '${sql.raw(intervalMap[period])}'`),
      ),
    )
 
  const total = result?.total ?? 0
  const up = result?.up ?? 0
  const down = total - up
  const uptimePercent = total === 0 ? 100 : Math.round((up / total) * 10_000) / 100
 
  return { total, up, down, uptimePercent }
}
 
/**
 * Incident history for a monitor, newest first.
 * Auth-gated: viewer must own the monitor's project.
 */
export async function listIncidents(
  monitorId: string,
  viewer: Viewer,
  limit = 50,
): Promise<Incident[]> {
  const monitor = await db.query.monitors.findFirst({
    where: eq(monitors.id, monitorId),
    columns: { projectId: true },
  })
  if (!monitor || !(await getProject(monitor.projectId, viewer))) return []
 
  return db.query.incidents.findMany({
    where: eq(incidents.monitorId, monitorId),
    orderBy: desc(incidents.startedAt),
    limit,
  })
}



/**
 * Returns SSL + domain expiry data for a project's domain monitor.
 * Used by the Monitoring dashboard to show expiry dates without
 * re-running the check.
 *
 * Reads from the most recent monitor_event's `detail` field for the
 * domain monitor — the probe writes a structured detail string there.
 * For richer data (exact days), the API route calls the checker directly
 * once per page load (cheap — it's cached by the OS resolver).
 */
export async function getDomainMonitor(
  projectId: string,
  viewer: Viewer,
): Promise<Monitor | null> {
  if (!(await getProject(projectId, viewer))) return null
  
  /* monitor error — findFirst returns T | undefined, but return type is Monitor | null.
   * Use explicit null check to satisfy TypeScript. */
  const result = await db.query.monitors.findFirst({
    where: and(
      eq(monitors.projectId, projectId),
      eq(monitors.type, 'domain'),
    ),
  })
  return result ?? null
}




/**
 * Ensures a domain monitor exists for a project.
 * Called when a user enables the Monitoring feature.
 *
 * intervalS = 86400 (daily) — SSL and domain expiry do not change
 * by the hour, and a daily check is plenty of warning at 14/30 days.
 */
export async function ensureDomainMonitor(
  projectId: string,
  viewer: Viewer,
): Promise<Monitor | null> {
  return setMonitor(projectId, viewer, {
    type: 'domain',
    enabled: true,
    intervalS: 86_400, // once per day
  })
}
 