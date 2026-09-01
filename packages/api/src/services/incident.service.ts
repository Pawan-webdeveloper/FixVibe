/*
 * Business logic layer for incident lifecycle management.
 *
 * Responsibilities:
 *  - Open a new incident when a monitor_event has ok = false
 *  - Resolve an open incident when a monitor_event has ok = true
 *  - Guard against duplicate open incidents per monitor
 *  - Emit structured logs for observability
 */

import {
  createIncident,
  findOpenIncident,
  resolveIncident,
  type DB,
  type OpenIncident,
  type ResolvedIncident,
} from '../../../db/src/repositories/incident.repository.ts' /* monitor error — was .js extension, corrected to .ts for consistency */

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

export interface MonitorCheckResult {
  monitorId: string
  ok: boolean
  statusCode?: number | null
  latencyMs?: number | null
  checkedAt: Date
  detail?: string | null
}

export type IncidentOutcome =
  | { action: 'opened'; incident: OpenIncident }
  | { action: 'resolved'; incident: ResolvedIncident }
  | { action: 'noop' }

/**
 * Called after every monitor_event is written.
 *
 * - If the check failed and no open incident exists → opens one.
 * - If the check failed and an open incident already exists → no-op (idempotent).
 * - If the check succeeded and an open incident exists → resolves it.
 * - If the check succeeded and no open incident exists → no-op.
 */
export async function handleMonitorCheck(
  db: DB,
  result: MonitorCheckResult,
): Promise<IncidentOutcome> {
  const open = await findOpenIncident(db, result.monitorId)

  if (!result.ok) {
    return handleDownEvent(db, result, open)
  }

  return handleUpEvent(db, result, open)
}

/* ------------------------------------------------------------------ */
/* Private helpers                                                      */
/* ------------------------------------------------------------------ */

async function handleDownEvent(
  db: DB,
  result: MonitorCheckResult,
  open: OpenIncident | null,
): Promise<IncidentOutcome> {
  // Already tracking an incident for this monitor — nothing to do.
  if (open) {
    return { action: 'noop' }
  }

  const incident = await createIncident(db, {
    monitorId: result.monitorId,
    startedAt: result.checkedAt,
    statusCode: result.statusCode ?? null,
    detail: buildDetail(result),
  })

  console.info('[incident] opened', {
    incidentId: incident.id,
    monitorId: result.monitorId,
    statusCode: result.statusCode,
    startedAt: incident.startedAt,
  })

  return { action: 'opened', incident: incident as OpenIncident }
}

async function handleUpEvent(
  db: DB,
  result: MonitorCheckResult,
  open: OpenIncident | null,
): Promise<IncidentOutcome> {
  // No open incident to resolve.
  if (!open) {
    return { action: 'noop' }
  }

  const resolved = await resolveIncident(db, open.id, result.checkedAt)
  if (!resolved) return { action: 'noop' }

  console.info('[incident] resolved', {
    incidentId: resolved.id,
    monitorId: result.monitorId,
    durationMs: resolved.durationMs,
    resolvedAt: resolved.resolvedAt,
  })

  return { action: 'resolved', incident: resolved }
}

function buildDetail(result: MonitorCheckResult): string | null {
  if (result.detail) return result.detail
  if (result.statusCode) return `HTTP ${result.statusCode}`
  return null
}