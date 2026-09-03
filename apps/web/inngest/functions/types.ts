/**
 * Shared event payload types for all monitor probes.
 * Keeping them here means the sweep and every probe stay in sync on the
 * shape of the data — a field rename is one edit, not three.
 */

import type { MonitorType } from '@scanlyfix/db'
import type { EVENTS } from '@/lib/inngest.ts'

// ─── Shared ────────────────────────────────────────────────────────────────────

/**
 * Who triggered this monitor check.
 *
 * WHY explicit union (not string):
 *  - cron      → regular scheduled sweep
 *  - deploy-hook → CI/CD triggered (Feature 5)
 *  - manual    → user triggered from dashboard (future)
 *
 * Exported so route.ts can use `TriggeredBy` type directly.
 */
export type TriggeredBy = 'cron' | 'deploy-hook' | 'manual'

// ─── MonitorDueEvent ───────────────────────────────────────────────────────────
/**
 * Emitted by monitor-sweep for uptime monitors.
 *
 * `triggeredBy` is optional:
 *  - Existing sweep does not send it (backward compatible — won't break)
 *  - deploy-hook sets it to 'deploy-hook'
 *  - Probes can log/use it for observability
 */
export interface MonitorDueEvent {
  name: string
  data: {
    monitorId: string
    type: MonitorType
    projectId: string
    url: string
    triggeredBy?: TriggeredBy   // ← NEW (optional — sweep still works without it)
  }
}

// ─── MonitoringDueEvent ────────────────────────────────────────────────────────
/**
 * Emitted by monitor-sweep for domain + SSL monitoring.
 * `type` discriminates which probe picks the event up.
 *
 * Same `triggeredBy` addition as MonitorDueEvent.
 */
export interface MonitoringDueEvent {
  name: typeof EVENTS.monitorDue
  data: {
    monitorId: string
    projectId: string
    url: string
    type: 'domain'
    triggeredBy?: TriggeredBy
  }
}