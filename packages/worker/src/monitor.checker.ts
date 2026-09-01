/*
 * The core polling function.
 *
 * Flow per tick:
 *  1. Fetch the URL for the monitor.
 *  2. Write a monitor_event row (always).
 *  3. Call handleMonitorCheck → opens or resolves an incident.
 *  4. Update monitors.lastStatus + monitors.enabled if needed.
 *
 * This file is intentionally side-effect-free except for DB writes
 * and the outgoing HTTP request, so it's easy to unit-test.
 */

/* uptime error — replaced raw fetch() with safeFetch() for SSRF protection,
 * replaced cross-package relative imports with package aliases */

import { eq } from 'drizzle-orm'
import { safeFetch } from '@scanlyfix/checks'
/* monitor error — replaced cross-package relative imports with package aliases */
import type { DB } from '../../db/src/repositories/incident.repository.ts'
import { handleMonitorCheck, type MonitorCheckResult } from '../../api/src/services/incident.service.ts'
import { monitorEvents, monitors } from '../../db/src/schema.ts'

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */
 export interface MonitorRow {
    id: string
  url: string
  intervalS: number
  enabled: boolean
  lastStatus: string | null
 }


  
/**
 * Checks a single monitor:
 *  - issues an HTTP HEAD/GET request
 *  - writes the monitor_event
 *  - triggers incident lifecycle
 *
 * @returns The incident action taken ('opened' | 'resolved' | 'noop')
 */
export async function checkMonitor(db: DB, monitor: MonitorRow) {
  const checkedAt = new Date()
  let ok = false
  let statusCode: number | null = null
  let latencyMs: number | null = null
  let detail: string | null = null
 
  /* ── 1. HTTP probe ─────────────────────────────────────────────── */
  const t0 = performance.now()
  try {
    /* uptime error — using safeFetch instead of raw fetch for SSRF protection.
     * safeFetch blocks requests to private IPs, cloud metadata endpoints,
     * and other internal addresses that a malicious monitor URL could target. */
    const res = await safeFetch(monitor.url, { timeoutMs: 10_000, maxBodyBytes: 4096 })
    latencyMs = Math.round(performance.now() - t0)
    statusCode = res.status
    ok = res.status < 400 /* monitor error — safeFetch returns FetchedPage which has status but no ok property. Compute ok from status. */
  } catch (err) {
    latencyMs = Math.round(performance.now() - t0)
    detail = err instanceof Error ? err.message : 'Unknown error'
    ok = false
  }


  /* ── 2. Write monitor_event ────────────────────────────────────── */
  await db.insert(monitorEvents).values({
    monitorId: monitor.id,
    ok,
    statusCode,
    latencyMs,
    ts: checkedAt,

  })



  /* ── 3. Update monitors.lastStatus ────────────────────────────── */
  const newStatus = ok ? 'up' : 'down'
  if (monitor.lastStatus !== newStatus) {
    await db
      .update(monitors)
      .set({ lastStatus: newStatus })
      .where(eq(monitors.id, monitor.id))
  }



  
  /* ── 4. Incident lifecycle ─────────────────────────────────────── */
  const checkResult: MonitorCheckResult = {
    monitorId: monitor.id,
    ok,
    statusCode,
    latencyMs,
    checkedAt,
    detail,
  }
  const outcome = await handleMonitorCheck(db, checkResult)
 
  return { ok, statusCode, latencyMs, outcome }
}