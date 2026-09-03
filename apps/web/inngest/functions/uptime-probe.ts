/**
 * FILE: apps/web/inngest/functions/uptime-probe.ts
 *
 * What changed from your existing file:
 *  1. Imported isMonitorSnoozed from @scanlyfix/db
 *  2. Added snooze check at the very start — before any step
 *
 * Everything else (alertConfig, evaluateOutcome, probe, record-and-alert,
 * deliver steps) is completely untouched.
 */

import { safeFetch } from '@scanlyfix/checks'
import {
  consecutiveFailures,
  createIncident,
  isMonitorSnoozed,
  recordAlertOnce,
  recordMonitorRun,
  resolveIncident,
} from '@scanlyfix/db'
import { db, monitors } from '@scanlyfix/db'
import { eq } from 'drizzle-orm'
import { deliverAlert } from '@/lib/alert-email.ts'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import { evaluateOutcome, AlertConfigSchema } from '@/lib/alert-threshold.ts'
import type { AlertConfig } from '@/lib/alert-threshold.ts'
import type { MonitorDueEvent } from './types.ts'

/** Enough for a slow origin, short enough that a hung host does not hold a worker. */
const PROBE_TIMEOUT_MS = 15_000

/** One failure is noise. Two in a row is a site that is down. */
const FAILURES_BEFORE_ALERT = 2

export const uptimeProbe = inngest.createFunction(
  {
    id: 'monitor-uptime',
    triggers: [{ event: EVENTS.monitorDue, if: 'event.data.type == "uptime"' }],
    concurrency: { limit: 20 },
    retries: 0,
  },
  async ({ event, step }) => {
    const { monitorId, projectId, url } = event.data as MonitorDueEvent['data']

    /* ── Snooze guard ────────────────────────────────────────────────
     *
     * Checked BEFORE any step — a snoozed monitor records nothing and
     * sends nothing. The probe still runs (sweep dispatched the event)
     * but exits cleanly here.
     *
     * WHY outside a step: isMonitorSnoozed is a fast indexed read
     * (uniqueIndex on monitorId). retries: 0 means no re-run risk.
     * A step here would add a network round-trip to Inngest for no gain.
     *
     * WHY not update lastRunAt: a snoozed check is intentionally skipped,
     * not a real run — advancing lastRunAt would delay the next real check.
     */
    const snoozed = await isMonitorSnoozed(monitorId)
    if (snoozed) {
      return { ok: true, alerted: false, streak: 0, alertId: null, snoozed: true }
    }

    /* ── Step 1: Probe ───────────────────────────────────────────────
     *
     * WHY alertConfig fetch INSIDE probe step (not a separate step):
     *  - Config read is fast (indexed by monitorId)
     *  - Not worth its own Inngest step / network round trip
     *  - If config changes between retries — fine, we want latest
     *
     * WHY threshold applied HERE (not in recordMonitorRun):
     *  - recordMonitorRun is a DB utility — no business logic
     *  - `ok` in monitorEvents should reflect the threshold
     *  - monitoring-probe + web-vitals-probe have own ok logic
     */
    const outcome = await step.run('probe', async () => {
      // ── Fetch alert config ──────────────────────────────────────────
      const monitorRow = await db.query.monitors.findFirst({
        where: eq(monitors.id, monitorId),
        columns: { alertConfig: true },
      })

      // WHY safeParse: alertConfig is jsonb — validate at runtime
      let alertConfig: AlertConfig | null = null
      if (monitorRow?.alertConfig) {
        const parsed = AlertConfigSchema.safeParse(monitorRow.alertConfig)
        alertConfig = parsed.success ? parsed.data : null
      }

      // ── HTTP probe ──────────────────────────────────────────────────
      const startedAt = Date.now()
      try {
        const response = await safeFetch(url, {
          timeoutMs: PROBE_TIMEOUT_MS,
          maxBodyBytes: 4096,
        })
        const latencyMs = Date.now() - startedAt
        const statusCode = response.status

        // Apply threshold — evaluateOutcome handles null config gracefully
        // (falls back to default: status >= 400 = down)
        const { ok, reason } = evaluateOutcome({ statusCode, latencyMs }, alertConfig)

        return {
          ok,
          statusCode,
          latencyMs,
          // WHY include threshold reason in detail: diff view + incident detail
          detail: ok ? null : (reason ?? `HTTP ${statusCode}`),
        }
      } catch (error) {
        // Network error / timeout — always down, no threshold applies
        return {
          ok: false,
          statusCode: null,
          latencyMs: Date.now() - startedAt,
          detail: error instanceof Error ? error.message : 'unreachable',
        }
      }
    })

    /* ── Step 2: Record + Alert ──────────────────────────────────────
     *
     * Unchanged from before — outcome.ok already reflects threshold.
     * recordMonitorRun stays as-is (no signature change needed).
     */
    const result = await step.run('record-and-alert', async () => {
      await recordMonitorRun(monitorId, outcome)

      if (outcome.ok) {
        await resolveIncident(monitorId)
        return { ok: true, alerted: false, streak: 0, alertId: null as string | null }
      }

      const streak = await consecutiveFailures(monitorId)

      if (streak < FAILURES_BEFORE_ALERT) {
        return { ok: false, alerted: false, streak, alertId: null as string | null }
      }

      const alert = await recordAlertOnce({
        projectId,
        kind: 'downtime',
        channel: 'email',
        payload: {
          url,
          streak,
          statusCode: outcome.statusCode,
          detail: outcome.detail,
        },
      })

      if (alert) {
        await createIncident(monitorId, {
          statusCode: outcome.statusCode,
          detail: outcome.detail,
        })
      }

      return { ok: false, alerted: alert !== null, streak, alertId: alert?.id ?? null }
    })

    /* ── Step 3: Deliver alert ───────────────────────────────────────
     * Own step — same reason as always.
     */
    const alertId = result.alertId
    if (alertId) await step.run('deliver', () => deliverAlert(alertId))

    return result
  },
)