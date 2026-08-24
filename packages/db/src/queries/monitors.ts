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

import { and, asc, desc, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../client.ts'
import { monitorEvents, monitors, projects, scans, type Monitor, type MonitorEvent } from '../schema.ts'
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
      .set({ lastRunAt: new Date(), lastStatus: outcome.ok ? 'ok' : 'failed' })
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
