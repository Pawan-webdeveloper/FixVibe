/**
 * FILE: apps/web/inngest/functions/uptime-probe.ts
 *
 * State machine for uptime monitoring:
 *   UP → FAILING(1 fail) → DOWN(2 fails = alert) → [reminder every N min] → RECOVERED(alert)
 *
 * Snooze behavior:
 *  - Probe ALWAYS runs (HTTP check, record event, advance lastRunAt)
 *  - Snooze ONLY suppresses alert dispatch
 *  - This prevents the busy-loop: sweep sees lastRunAt advanced, doesn't re-dispatch
 *
 * Reminder behavior:
 *  - When reminderIntervalMin is configured, sends reminder emails every N minutes
 *  - Reminders use dedupKey to prevent duplicate emails
 *  - Reminders stop when the site recovers
 *
 * Probe features:
 *  - Custom headers: decrypted from DB, attached to request
 *  - HTTP method: GET or HEAD (from alertConfig.httpMethod)
 *  - Follow redirects: can be disabled (3xx returned as-is)
 *  - Keyword check: response body contains/doesn't contain specific text
 *  - Expected status codes: exact match for 2xx
 */

import { safeFetch } from '@scanlyfix/checks'
import {
  consecutiveFailures,
  createIncident,
  getAlertChannels,
  getOpenIncident,
  isInMaintenanceWindow,
  isMonitorSnoozed,
  recordAlertOnce,
  recordMonitorRun,
  resolveIncident,
} from '@scanlyfix/db'
import { db, monitors, projects } from '@scanlyfix/db'
import { eq } from 'drizzle-orm'
import { deliverAlert } from '@/lib/alert-email.ts'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import {
  evaluateOutcome,
  AlertConfigSchema,
  resolveNotifyChannels,
} from '@/lib/alert-threshold.ts'
import { prepareHeaders } from '@/lib/header-encryption.ts'
import type { AlertConfig } from '@/lib/alert-threshold.ts'
import type { MonitorDueEvent } from './types.ts'
import { notifyConfirmedSubscribersForMonitor } from '@/lib/status-subscriber-email.ts'

/** Enough for a slow origin, short enough that a hung host does not hold a worker. */
const PROBE_TIMEOUT_MS = 15_000

/** One failure is noise. Two in a row is a site that is down. */
const FAILURES_BEFORE_ALERT = 2

/** Max body bytes for keyword check (64KB) */
const KEYWORD_CHECK_MAX_BODY_BYTES = 65536

/**
 * Extracts the host of a URL for log lines and subject lines.
 * Returns the raw input if it is not parseable so a malformed project
 * URL does not crash the probe.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * Converts milliseconds to a human-readable duration string.
 * Examples: "14m 30s", "2h 15m", "1d 3h", "5s"
 */
function humanizeDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`

  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

/**
 * Calculates the reminder time slot based on incident start time and interval.
 * Returns a slot number that increments every intervalMin minutes.
 *
 * Example: If incident started at 10:00 and interval is 30min:
 *   - 10:00-10:30 → slot 0 (initial alert)
 *   - 10:30-11:00 → slot 1 (first reminder)
 *   - 11:00-11:30 → slot 2 (second reminder)
 */
function getReminderSlot(startedAt: Date, intervalMin: number): number {
  const now = Date.now()
  const elapsed = now - startedAt.getTime()
  const intervalMs = intervalMin * 60 * 1000
  return Math.floor(elapsed / intervalMs)
}

export const uptimeProbe = inngest.createFunction(
  {
    id: 'monitor-uptime',
    triggers: [{ event: EVENTS.monitorDue, if: 'event.data.type == "uptime"' }],
    concurrency: { limit: 20 },
    retries: 0,
  },
  async ({ event, step }) => {
    const { monitorId, projectId, url } = event.data as MonitorDueEvent['data']

    // Validate URL format before proceeding
    try {
      new URL(url)
    } catch {
      return { ok: false, error: 'unparseable project URL' }
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

      // ── Prepare request options ─────────────────────────────────────
      const method = alertConfig?.httpMethod ?? 'GET'
      const followRedirects = alertConfig?.followRedirects ?? true

      // Decrypt custom headers if present
      const customHeaders = alertConfig?.customHeaders
        ? prepareHeaders(alertConfig.customHeaders)
        : {}

      // Determine max body bytes based on whether keyword check is needed
      const needsBody = alertConfig?.keywordCheck !== undefined
      const maxBodyBytes = needsBody ? KEYWORD_CHECK_MAX_BODY_BYTES : 4096

      // ── HTTP probe ──────────────────────────────────────────────────
      const startedAt = Date.now()
      try {
        const response = await safeFetch(url, {
          timeoutMs: PROBE_TIMEOUT_MS,
          maxBodyBytes,
          followRedirects,
          headers: customHeaders,
        })
        const latencyMs = Date.now() - startedAt
        const statusCode = response.status
        const body = needsBody ? response.body : undefined

        // Apply threshold — evaluateOutcome handles null config gracefully
        // (falls back to default: status >= 400 = down)
        const { ok, reason } = evaluateOutcome({ statusCode, latencyMs, body }, alertConfig)

        // Build detail string
        let detail: string | null = null
        if (!ok) {
          detail = reason ?? `HTTP ${statusCode}`
        }

        return {
          ok,
          statusCode,
          latencyMs,
          // WHY include threshold reason in detail: diff view + incident detail
          detail,
          alertConfig,
        }
      } catch (error) {
        // Network error / timeout — always down, no threshold applies
        return {
          ok: false,
          statusCode: null,
          latencyMs: Date.now() - startedAt,
          detail: error instanceof Error ? error.message : 'unreachable',
          alertConfig,
        }
      }
    })

    /* ── Step 2: Record + Alert ──────────────────────────────────────
     *
     * CRITICAL: Record event and advance lastRunAt ALWAYS (even when snoozed).
     * This prevents the busy-loop: sweep sees lastRunAt advanced, doesn't re-dispatch.
     *
     * Snooze ONLY suppresses alert dispatch — probe data and uptime continuity
     * are preserved.
     *
     * State machine:
     *   UP → FAILING(1 fail) → DOWN(2 fails = alert) → [reminder every N min] → RECOVERED(alert)
     */
    const result = await step.run('record-and-alert', async () => {
      // ALWAYS record the event and advance lastRunAt
      // This is critical to prevent the sweep busy-loop
      await recordMonitorRun(monitorId, outcome)

      if (outcome.ok) {
        // ── Recovery detection ────────────────────────────────────────
        // Check if there was an open incident before resolving
        // If yes, this is a recovery — send a recovery alert
        const resolvedIncidents = await resolveIncident(monitorId)

        if (resolvedIncidents.length > 0) {
          // Use the most recent incident for the recovery alert
          const incident = resolvedIncidents[0]!
          const downFor = humanizeDuration(incident.durationMs)

          // Check if snoozed — snoozed monitors don't get recovery alerts either
          const snoozed = await isMonitorSnoozed(monitorId)
          if (!snoozed) {
            // Maintenance windows also suppress recovery alerts — the
            // user already knows the monitor is in flux and does not
            // need a recovery bell to say "it came back".
            const inMaintenance = await isInMaintenanceWindow(monitorId)
            if (!inMaintenance) {
              const alert = await recordAlertOnce({
                projectId,
                kind: 'recovered',
                channel: 'email',
                payload: {
                  url,
                  downFor,
                  recoveredAt: new Date().toISOString(),
                  incidentId: incident.id,
                  statusCode: incident.statusCode,
                  detail: incident.detail,
                },
              })

              if (alert) {
                // Notify status-page subscribers — the incident is
                // resolved, which is the event subscribers actually
                // want closure on.
                const [project] = await db
                  .select({ name: projects.name, url: projects.url, slug: projects.slug })
                  .from(projects)
                  .where(eq(projects.id, projectId))
                  .limit(1)
                if (project) {
                  await notifyConfirmedSubscribersForMonitor({
                    monitorId,
                    email: {
                      projectName: project.name,
                      projectUrl: project.url,
                      projectSlug: project.slug,
                      incidentId: incident.id,
                      stage: 'resolved',
                      headline: `${hostOf(project.url)} is back up`,
                      message:
                        `${project.name} is responding normally again. ` +
                        `Was down for ${downFor}.`,
                      isInitial: false,
                    },
                  })
                }

                return {
                  ok: true,
                  alerted: true,
                  recovered: true,
                  streak: 0,
                  alertId: alert.id,
                  downFor,
                  alertConfig: outcome.alertConfig,
                }
              }
            }
          }
        }

        return { ok: true, alerted: false, recovered: false, streak: 0, alertId: null as string | null, alertConfig: outcome.alertConfig as AlertConfig | null }
      }

      const streak = await consecutiveFailures(monitorId)

      if (streak < FAILURES_BEFORE_ALERT) {
        return { ok: false, alerted: false, streak, alertId: null as string | null, alertConfig: outcome.alertConfig as AlertConfig | null }
      }

      // ── Snooze check: ONLY suppress alert dispatch ──────────────────
      // WHY after recordMonitorRun: event data and lastRunAt must always be updated
      // WHY before recordAlertOnce: snoozed monitors should not generate alerts
      const snoozed = await isMonitorSnoozed(monitorId)
      if (snoozed) {
        return { ok: false, alerted: false, streak, alertId: null as string | null, snoozed: true, alertConfig: outcome.alertConfig as AlertConfig | null }
      }

      // ── Maintenance window: same contract as a snooze ──────────────
      // Probe and event recording keep running; only the alert dispatch
      // short-circuits. The two checks are independent: a monitor can be
      // in a maintenance window AND snoozed at the same time — the row
      // record shows whichever was true at the moment of the check.
      const inMaintenance = await isInMaintenanceWindow(monitorId)
      if (inMaintenance) {
        return { ok: false, alerted: false, streak, alertId: null as string | null, maintenance: true, alertConfig: outcome.alertConfig as AlertConfig | null }
      }

      // ── Check for existing open incident ────────────────────────────
      const openIncident = await getOpenIncident(monitorId)

      // ── Initial downtime alert ──────────────────────────────────────
      if (!openIncident) {
        // No open incident — this is the first alert (DOWN transition)
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
          const incident = await createIncident(monitorId, {
            statusCode: outcome.statusCode,
            detail: outcome.detail,
          })

          // Notify status-page subscribers (Phase 6.3). Same step as
          // the alert — these are coupled events from the visitor's
          // point of view, and splitting them across two steps would
          // let a retry send the alert twice without sending the
          // subscriber email twice (or vice versa).
          if (incident) {
            const [project] = await db
              .select({ name: projects.name, url: projects.url, slug: projects.slug })
              .from(projects)
              .where(eq(projects.id, projectId))
              .limit(1)
            if (project) {
              const observed = outcome.statusCode
                ? `HTTP ${outcome.statusCode}`
                : (outcome.detail ?? 'no response')
              await notifyConfirmedSubscribersForMonitor({
                monitorId,
                email: {
                  projectName: project.name,
                  projectUrl: project.url,
                  projectSlug: project.slug,
                  incidentId: incident.id,
                  stage: 'investigating',
                  headline: `${hostOf(project.url)} is not responding`,
                  message:
                    `${project.name} has failed ${streak} consecutive checks. ` +
                    `Observed: ${observed}. We are investigating.`,
                  isInitial: true,
                },
              })
            }
          }
        }

        return { ok: false, alerted: alert !== null, streak, alertId: alert?.id ?? null, alertConfig: outcome.alertConfig as AlertConfig | null }
      }

      // ── Reminder logic ──────────────────────────────────────────────
      // Check if reminders are configured
      const alertConfig = outcome.alertConfig
      const reminderIntervalMin = alertConfig?.reminderIntervalMin

      if (!reminderIntervalMin) {
        // Reminders disabled — no alert
        return { ok: false, alerted: false, streak, alertId: null as string | null, alertConfig: alertConfig as AlertConfig | null }
      }

      // Calculate reminder slot
      const currentSlot = getReminderSlot(openIncident.startedAt, reminderIntervalMin)

      // Slot 0 is the initial alert (already sent), so skip it
      if (currentSlot === 0) {
        return { ok: false, alerted: false, streak, alertId: null as string | null, alertConfig: alertConfig as AlertConfig | null }
      }

      // Build dedupKey for this reminder
      const dedupKey = `downtime-${monitorId}-${openIncident.id}-reminder-${currentSlot}`

      // Check if snoozed before sending reminder
      const snoozedForReminder = await isMonitorSnoozed(monitorId)
      if (snoozedForReminder) {
        return { ok: false, alerted: false, streak, alertId: null as string | null, snoozed: true, alertConfig: alertConfig as AlertConfig | null }
      }

      // Maintenance windows suppress reminders for the same reason they
      // suppress the initial alert — the user already knows.
      const inMaintenanceForReminder = await isInMaintenanceWindow(monitorId)
      if (inMaintenanceForReminder) {
        return { ok: false, alerted: false, streak, alertId: null as string | null, maintenance: true, alertConfig: alertConfig as AlertConfig | null }
      }

      // Send reminder
      const reminderAlert = await recordAlertOnce({
        projectId,
        kind: 'downtime-reminder',
        channel: 'email',
        payload: {
          url,
          streak,
          statusCode: outcome.statusCode,
          detail: outcome.detail,
          reminderNumber: currentSlot,
          downFor: humanizeDuration(Date.now() - openIncident.startedAt.getTime()),
        },
        dedupKey,
      })

      return {
        ok: false,
        alerted: reminderAlert !== null,
        streak,
        alertId: reminderAlert?.id ?? null,
        reminder: reminderAlert !== null,
        alertConfig: alertConfig as AlertConfig | null,
      }
    })

    /* ── Step 3: Deliver alert ───────────────────────────────────────
     * Own step — same reason as always.
     *
     * The routing decision (which channels to actually fan out to) is
     * made HERE, at delivery time, so it reflects the monitor's current
     * alertConfig. resolveNotifyChannels handles the three cases:
     *   - notifyChannels undefined / empty → all enabled channels + email
     *   - notifyChannels non-empty        → email suppressed, only listed
     *     channels get a fan-out
     */
    const alertId = result.alertId
    if (alertId) {
      try {
        const channels = await getAlertChannels(projectId)
        const enabledIds = channels.filter((c) => c.enabled).map((c) => c.id)
        const routing = resolveNotifyChannels(result.alertConfig ?? null, enabledIds)
        await deliverAlert(alertId, routing)
      } catch (err) {
        console.error('[alert] Delivery failed:', err)
      }
    }

    return result
  },
)