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
import {
  incidents,
  monitorEvents,
  monitors,
  projects,
  scans,
  dnsSnapshots,
  snoozedMonitors,
  type Incident,
  type Monitor,
  type MonitorEvent,
  type SnoozedMonitor,
} from '../schema.ts' /* monitor error — added missing Incident type import */
import { getProject } from './projects.ts'
import type { Viewer } from './viewer.ts'
// ─── DNS Snapshot Queries ─────────────────────────────────────────────────────

import type { DnsRecord } from '../dns-checker.ts'
import { DnsRecordsSchema } from '../dns-checker.ts'

import type { MonitorEventDiff, MonitorLogEntry } from '../types/monitor-diff.ts'
import { MonitorEventDiffSchema } from '../types/monitor-diff.ts'




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
      alertConfig: monitors.alertConfig,
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




/*
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
 

/*
 * ACTION: Add getPublicStatus() at the bottom of the file.
 *
 * SYSTEM QUERY — no Viewer. The status page is public by design:
 * a slug is not a secret and the data it returns is already visible
 * to anyone who can watch the site's HTTP responses. What it must
 * NOT return is anything private — no email, no userId, no internal ids
 * beyond what the page actually needs.
 */
 
export interface PublicIncident {
  startedAt: Date
  resolvedAt: Date | null
  durationMs: number | null
  statusCode: number | null
  detail: string | null
}
 
export interface PublicStatusData {
  projectName: string
  projectUrl: string
  /** Current status from the uptime monitor's lastStatus. */
  currentStatus: 'ok' | 'failed' | 'unknown'
  /** ISO string of last check. */
  lastCheckedAt: Date | null
  /** Uptime % over last 90 days. */
  uptimePercent: number
  /** Daily buckets for the 90-day strip — true = all checks ok that day. */
  dailyBuckets: Array<{ date: string; ok: boolean; total: number }>
  /** Last 10 incidents, newest first. */
  recentIncidents: PublicIncident[]
}
 




/**
 * Returns everything the public status page needs in one query set.
 * Keyed by project slug — slugs are public (they appear in URLs the
 * owner shares), so no auth check is needed or appropriate here.
 *
 * Returns null when the slug does not exist, which the page renders
 * as a 404 rather than an empty state — a missing slug is not a
 * project with no data, it is a URL that means nothing.
 */
export async function getPublicStatus(slug: string): Promise<PublicStatusData | null> {
  // 1. Resolve slug → project + uptime monitor
  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, slug),
    columns: { id: true, name: true, url: true },
  })
  if (!project) return null
 
  const monitor = await db.query.monitors.findFirst({
    where: and(
      eq(monitors.projectId, project.id),
      eq(monitors.type, 'uptime'),
    ),
    columns: { id: true, lastStatus: true, lastRunAt: true },
  })
 
  // Project exists but uptime monitor not set up yet — return a stub.
  if (!monitor) {
    return {
      projectName: project.name,
      projectUrl: project.url,
      currentStatus: 'unknown',
      lastCheckedAt: null,
      uptimePercent: 100,
      dailyBuckets: [],
      recentIncidents: [],
    }
  }
 
  const monitorId = monitor.id
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // 90 days ago
 
  // 2. Uptime % over 90 days
  const [uptimeRow] = await db
    .select({
      total: sql<number>`count(*)::int`,
      up: sql<number>`count(*) filter (where ${monitorEvents.ok})::int`,
    })
    .from(monitorEvents)
    .where(
      and(
        eq(monitorEvents.monitorId, monitorId),
        gte(monitorEvents.ts, cutoff),
      ),
    )
 
  const total = uptimeRow?.total ?? 0
  const up = uptimeRow?.up ?? 0
  const uptimePercent = total === 0 ? 100 : Math.round((up / total) * 10_000) / 100
 
  // 3. Daily buckets for the 90-day strip
  // Group events by UTC date, compute ok = all checks passed that day.
  const rawEvents = await db
    .select({
      date: sql<string>`date_trunc('day', ${monitorEvents.ts} at time zone 'utc')::date::text`,
      total: sql<number>`count(*)::int`,
      up: sql<number>`count(*) filter (where ${monitorEvents.ok})::int`,
    })
    .from(monitorEvents)
    .where(
      and(
        eq(monitorEvents.monitorId, monitorId),
        gte(monitorEvents.ts, cutoff),
      ),
    )
    .groupBy(sql`date_trunc('day', ${monitorEvents.ts} at time zone 'utc')::date`)
    .orderBy(sql`date_trunc('day', ${monitorEvents.ts} at time zone 'utc')::date`)
 
  const dailyBuckets = rawEvents.map((row) => ({
    date: row.date,
    ok: row.up === row.total,
    total: row.total,
  }))
 
  // 4. Recent incidents (last 10)
  const recentIncidents = await db.query.incidents.findMany({
    where: eq(incidents.monitorId, monitorId),
    orderBy: desc(incidents.startedAt),
    limit: 10,
    columns: {
      startedAt: true,
      resolvedAt: true,
      durationMs: true,
      statusCode: true,
      detail: true,
    },
  })
 
  return {
    projectName: project.name,
    projectUrl: project.url,
    currentStatus: monitor.lastStatus === 'up' ? 'ok' : monitor.lastStatus === 'down' ? 'failed' : 'unknown',
    lastCheckedAt: monitor.lastRunAt,
    uptimePercent,
    dailyBuckets,
    recentIncidents,
  }
}
 

/**
 * Latest DNS snapshot fetch karta hai ek monitor ke liye.
 * Returns null agar pehli baar check ho raha hai (no baseline yet).
 */
export async function getLatestDnsSnapshot(
  monitorId: string,
): Promise<DnsRecord[] | null> {
  const row = await db.query.dnsSnapshots.findFirst({
    where: eq(dnsSnapshots.monitorId, monitorId),
    orderBy: [desc(dnsSnapshots.createdAt)],
    columns: { records: true },
  })

  if (!row) return null

  // WHY runtime parse: jsonb se aaya data untyped hota hai — validate karo
  const parsed = DnsRecordsSchema.safeParse(row.records)
  return parsed.success ? parsed.data : null
}

/**
 * Naya DNS snapshot insert karta hai.
 * Old snapshots delete nahi hote — audit trail ke liye useful hai.
 */
export async function recordDnsSnapshot(
  monitorId: string,
  records: DnsRecord[],
): Promise<void> {
  await db.insert(dnsSnapshots).values({
    monitorId,
    records,
  })
}



// ─── recentEventsWithDiff ──────────────────────────────────────────────────────
/**
 * Latest monitor events fetch karta hai, har event ke saath
 * previous event se computed diff attach karta hai.
 *
 * WHY on-the-fly compute (DB column pe nahi):
 *  - Probe code touch nahi karna padta
 *  - Always accurate — stored diff stale ho sakta hai
 *  - limit+1 trick se sirf ek DB call
 *
 * Security:
 *  - Viewer authorization: monitor ka project viewer ka hona chahiye
 *  - limit cap: unbounded queries block
 */
export async function recentEventsWithDiff(
  monitorId: string,
  viewer: Viewer,                    // tumhara existing Viewer type
  limit = 50,
): Promise<MonitorLogEntry[]> {

  // ── Input sanitization ──────────────────────────────────────────────────────
  const safeLimit = Math.min(Math.max(1, limit), 200)
  // WHY cap at 200: koi bhi 10k rows pull na kar sake accidentally

  // ── Authorization ───────────────────────────────────────────────────────────
  // WHY pehle auth check: DB se unnecessary data pull karne se pehle
  const monitor = await db.query.monitors.findFirst({
    where: eq(monitors.id, monitorId),
    columns: { projectId: true },
  })

  if (!monitor) return []

  const project = await getProject(monitor.projectId, viewer)
  if (!project) return []
  // WHY getProject use: tumhara existing auth pattern — consistency

  // ── Fetch limit+1 rows ──────────────────────────────────────────────────────
  // WHY +1: last event ka diff compute karne ke liye uske pehle
  // wala event chahiye — extra row fetch karo, slice karo baad mein
  const rows = await db.query.monitorEvents.findMany({
    where: eq(monitorEvents.monitorId, monitorId),
    orderBy: [desc(monitorEvents.ts)],
    limit: safeLimit + 1,
    columns: {
      id: true,
      monitorId: true,
      ok: true,
      statusCode: true,
      latencyMs: true,
      detail: true,
      ts: true,
    },
  })

  // ── Compute diffs ───────────────────────────────────────────────────────────
  // rows[0] = most recent, rows[1] = one before that (desc order)
  // so rows[i+1] = previous event in time

  const withDiffs: MonitorLogEntry[] = rows
    .slice(0, safeLimit)           // extra (+1) row remove karo
    .map((event, i) => {
      const prev = rows[i + 1]    // older event (one step back in time)

      let diff: MonitorEventDiff | null = null

      if (prev) {
        const rawDiff: MonitorEventDiff = {}

        // Sirf woh fields include karo jo actually change hue
        // WHY: unnecessary noise avoid karo — agar latency thoda change hua
        //      toh bhi diff show hoga, but statusCode same raha toh woh diff nahi
        if (prev.statusCode !== event.statusCode) {
          rawDiff.statusCode = { from: prev.statusCode, to: event.statusCode }
        }

        if (prev.ok !== event.ok || prev.latencyMs !== event.latencyMs) {
          rawDiff.latencyMs = { from: prev.latencyMs, to: event.latencyMs }
        }

        if (prev.detail !== event.detail) {
          rawDiff.detail = { from: prev.detail, to: event.detail }
        }

        // WHY safeParse: empty rawDiff ({}) ko null treat karo —
        // agar kuch bhi nahi change hua toh diff = null, not {}
        const parsed = MonitorEventDiffSchema.safeParse(rawDiff)
        const isEmpty = Object.keys(rawDiff).length === 0
        diff = parsed.success && !isEmpty ? parsed.data : null
      }

      return {
        id: event.id,
        monitorId: event.monitorId,
        ok: event.ok,
        statusCode: event.statusCode,
        latencyMs: event.latencyMs,
        detail: event.detail,
        ts: event.ts.toISOString(),   // WHY serialize: JSON.stringify safe
        diff,
      }
    })

  return withDiffs
}







/* -------------------------------------------------------------------------- */
/* Snooze queries                                                              */
/* -------------------------------------------------------------------------- */
 
/**
 * SYSTEM QUERY — no Viewer.
 * Called from the probe before alerting — fast indexed lookup.
 *
 * Returns true when an active (non-expired) snooze exists for this monitor.
 * A snooze with expiresAt = null is active until manually cleared.
 */
export async function isMonitorSnoozed(monitorId: string): Promise<boolean> {
  const snooze = await db.query.snoozedMonitors.findFirst({
    where: and(
      eq(snoozedMonitors.monitorId, monitorId),
      or(
        isNull(snoozedMonitors.expiresAt),
        gte(snoozedMonitors.expiresAt, new Date()),
      ),
    ),
    columns: { id: true },
  })
  return snooze !== undefined
}
 
/**
 * Returns the active snooze for a monitor, or null if not snoozed.
 * Auth-gated — viewer must own the monitor's project.
 */
export async function getActiveSnooze(
  monitorId: string,
  viewer: Viewer,
): Promise<SnoozedMonitor | null> {
  const monitor = await db.query.monitors.findFirst({
    where: eq(monitors.id, monitorId),
    columns: { projectId: true },
  })
  if (!monitor || !(await getProject(monitor.projectId, viewer))) return null
 
  const snooze = await db.query.snoozedMonitors.findFirst({
    where: and(
      eq(snoozedMonitors.monitorId, monitorId),
      or(
        isNull(snoozedMonitors.expiresAt),
        gte(snoozedMonitors.expiresAt, new Date()),
      ),
    ),
  })
 
  return snooze ?? null
}
 
/**
 * Snoozes a monitor for a given duration or indefinitely.
 *
 * Upserts — if a snooze already exists it is replaced. This lets a user
 * extend a snooze without having to unsnooze first.
 *
 * Auth-gated — viewer must own the monitor's project.
 */
export async function snoozeMonitor(
  monitorId: string,
  viewer: Viewer,
  options: { expiresAt?: Date | null; reason?: string | null },
): Promise<SnoozedMonitor | null> {
  if (viewer.kind !== 'user') return null
 
  const monitor = await db.query.monitors.findFirst({
    where: eq(monitors.id, monitorId),
    columns: { projectId: true },
  })
  if (!monitor || !(await getProject(monitor.projectId, viewer))) return null
 
  // Delete existing snooze first — uniqueIndex enforces one per monitor,
  // and onConflictDoUpdate on a unique index is cleaner than update.
  await db
    .delete(snoozedMonitors)
    .where(eq(snoozedMonitors.monitorId, monitorId))
 
  const [row] = await db
    .insert(snoozedMonitors)
    .values({
      monitorId,
      createdBy: viewer.userId,
      expiresAt: options.expiresAt ?? null,
      reason: options.reason ?? null,
    })
    .returning()
 
  return row ?? null
}
 
/**
 * Removes the snooze for a monitor immediately.
 * Auth-gated — viewer must own the monitor's project.
 */
export async function unsnoozeMonitor(
  monitorId: string,
  viewer: Viewer,
): Promise<void> {
  const monitor = await db.query.monitors.findFirst({
    where: eq(monitors.id, monitorId),
    columns: { projectId: true },
  })
  if (!monitor || !(await getProject(monitor.projectId, viewer))) return
 
  await db
    .delete(snoozedMonitors)
    .where(eq(snoozedMonitors.monitorId, monitorId))
}
 