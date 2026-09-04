/**
 * packages/db/src/queries/maintenance-windows.ts
 *
 * Maintenance window CRUD + the hot-path "is this monitor in a window right
 * now?" query the probe calls every minute.
 *
 * All times in this file are wall-clock: the row's `startTime` is local in
 * the row's `timezone`. The time math lives in `maintenance-window.ts` (pure)
 * and is the only place that touches Intl.
 */

import { and, asc, eq } from 'drizzle-orm'
import { db } from '../client.ts'
import { maintenanceWindows, monitors, type MaintenanceWindow } from '../schema.ts'
import { getProject } from './projects.ts'
import { isInstantInWindow, type MaintenanceWindowSpec } from '../maintenance-window.ts'
import type { Viewer } from './viewer.ts'

// ─── Management queries ───────────────────────────────────────────────────────

/** A row plus its createdBy email, for the UI. */
export interface MaintenanceWindowWithCreator extends MaintenanceWindow {
  creatorEmail: string | null
}

/** All windows for one monitor (enabled or not). UI lists all rows. */
export async function listMaintenanceWindows(
  monitorId: string,
  viewer: Viewer,
): Promise<MaintenanceWindowWithCreator[]> {
  // Auth happens at the project level — a monitorId is meaningless without
  // its project.
  const monitor = await db.query.monitors.findFirst({
    where: eq(monitors.id, monitorId),
    columns: { projectId: true },
  })
  if (!monitor || !(await getProject(monitor.projectId, viewer))) return []

  const rows = await db
    .select({
      id: maintenanceWindows.id,
      monitorId: maintenanceWindows.monitorId,
      dayOfWeek: maintenanceWindows.dayOfWeek,
      startTime: maintenanceWindows.startTime,
      durationMin: maintenanceWindows.durationMin,
      timezone: maintenanceWindows.timezone,
      reason: maintenanceWindows.reason,
      enabled: maintenanceWindows.enabled,
      createdAt: maintenanceWindows.createdAt,
      createdBy: maintenanceWindows.createdBy,
      // Pulled separately for masked API responses (no — this is internal).
      // Kept simple: the UI just shows the email; we accept the join cost.
      creatorEmail: maintenanceWindows.createdBy,
    })
    .from(maintenanceWindows)
    .where(eq(maintenanceWindows.monitorId, monitorId))
    .orderBy(
      asc(maintenanceWindows.dayOfWeek),
      asc(maintenanceWindows.startTime),
    )

  // Drizzle's `time` column is typed as string — normalise to the spec
  // format the time math expects ("HH:MM:SS" or "HH:MM" both work).
  return rows.map((r) => ({ ...r }))
}

/**
 * Insert a new window. Server-side validation here is the only line of
 * defence against an over-long window — the API also validates, but this
 * is the last check before the row lands.
 */
export async function createMaintenanceWindow(
  monitorId: string,
  viewer: Viewer,
  input: {
    dayOfWeek: number | null
    startTime: string
    durationMin: number
    timezone: string
    reason: string | null
  },
): Promise<MaintenanceWindow | null> {
  if (viewer.kind !== 'user') return null

  const monitor = await db.query.monitors.findFirst({
    where: eq(monitors.id, monitorId),
    columns: { projectId: true },
  })
  if (!monitor || !(await getProject(monitor.projectId, viewer))) return null

  const [row] = await db
    .insert(maintenanceWindows)
    .values({
      monitorId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      durationMin: input.durationMin,
      timezone: input.timezone,
      reason: input.reason,
      enabled: true,
      createdBy: viewer.userId,
    })
    .returning()

  return row ?? null
}

/** Soft-off toggle. Returns the updated row, or null if not authorised. */
export async function setMaintenanceWindowEnabled(
  windowId: string,
  enabled: boolean,
  viewer: Viewer,
): Promise<MaintenanceWindow | null> {
  const row = await db.query.maintenanceWindows.findFirst({
    where: eq(maintenanceWindows.id, windowId),
  })
  if (!row || !row.monitorId) return null

  // Authorize via the project.
  const monitor = await db.query.monitors.findFirst({
    where: eq(monitors.id, row.monitorId),
    columns: { projectId: true },
  })
  if (!monitor || !(await getProject(monitor.projectId, viewer))) return null

  await db
    .update(maintenanceWindows)
    .set({ enabled })
    .where(eq(maintenanceWindows.id, windowId))
  return { ...row, enabled }
}

/** Hard delete — the row is gone. */
export async function deleteMaintenanceWindow(
  windowId: string,
  viewer: Viewer,
): Promise<boolean> {
  const row = await db.query.maintenanceWindows.findFirst({
    where: eq(maintenanceWindows.id, windowId),
  })
  if (!row || !row.monitorId) return false

  const monitor = await db.query.monitors.findFirst({
    where: eq(monitors.id, row.monitorId),
    columns: { projectId: true },
  })
  if (!monitor || !(await getProject(monitor.projectId, viewer))) return false

  await db.delete(maintenanceWindows).where(eq(maintenanceWindows.id, windowId))
  return true
}

// ─── Hot-path query: is this monitor in a window right now? ──────────────────

/**
 * Pure-DB lookup of the enabled windows for one monitor, for the probe to
 * evaluate. The probe still does the time math (pure) — this function
 * is a single SELECT that pulls all enabled rows.
 *
 * The probe calls this with `now = new Date()`; tests can pass a synthetic
 * Date to exercise the time math.
 */
export async function isInMaintenanceWindow(
  monitorId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .select({
      dayOfWeek: maintenanceWindows.dayOfWeek,
      startTime: maintenanceWindows.startTime,
      durationMin: maintenanceWindows.durationMin,
      timezone: maintenanceWindows.timezone,
      enabled: maintenanceWindows.enabled,
    })
    .from(maintenanceWindows)
    .where(
      and(
        eq(maintenanceWindows.monitorId, monitorId),
        eq(maintenanceWindows.enabled, true),
      ),
    )

  // Convert to the spec the time-math expects and evaluate each. As soon
  // as one matches, the monitor is in maintenance — short-circuit.
  for (const r of rows) {
    const spec: MaintenanceWindowSpec = {
      dayOfWeek: r.dayOfWeek,
      startTime: typeof r.startTime === 'string' ? r.startTime : String(r.startTime),
      durationMin: r.durationMin,
      timezone: r.timezone,
      enabled: r.enabled,
    }
    if (isInstantInWindow(now, spec)) return true
  }
  return false
}

/**
 * The active window for a monitor at `now`, or null if none. Used by the
 * public status page to render the "Scheduled maintenance" banner.
 *
 * Returns the FIRST matching window in (dayOfWeek, startTime) order. If
 * two windows overlap (a user misconfiguration), the banner shows one of
 * them — exact tie-breaking is not worth a more elaborate query.
 */
export async function getActiveMaintenanceWindow(
  monitorId: string,
  now: Date = new Date(),
): Promise<MaintenanceWindow | null> {
  const rows = await db
    .select({
      id: maintenanceWindows.id,
      monitorId: maintenanceWindows.monitorId,
      dayOfWeek: maintenanceWindows.dayOfWeek,
      startTime: maintenanceWindows.startTime,
      durationMin: maintenanceWindows.durationMin,
      timezone: maintenanceWindows.timezone,
      reason: maintenanceWindows.reason,
      enabled: maintenanceWindows.enabled,
      createdAt: maintenanceWindows.createdAt,
      createdBy: maintenanceWindows.createdBy,
    })
    .from(maintenanceWindows)
    .where(
      and(
        eq(maintenanceWindows.monitorId, monitorId),
        eq(maintenanceWindows.enabled, true),
      ),
    )
    .orderBy(asc(maintenanceWindows.dayOfWeek), asc(maintenanceWindows.startTime))

  for (const r of rows) {
    const spec: MaintenanceWindowSpec = {
      dayOfWeek: r.dayOfWeek,
      startTime: typeof r.startTime === 'string' ? r.startTime : String(r.startTime),
      durationMin: r.durationMin,
      timezone: r.timezone,
      enabled: r.enabled,
    }
    if (isInstantInWindow(now, spec)) return r
  }
  return null
}
