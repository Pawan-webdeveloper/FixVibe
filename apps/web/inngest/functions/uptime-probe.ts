/**
 * Is the site answering.
 *
 * One request through safeFetch, which means the SSRF guard applies here as it
 * does everywhere else — a monitor is still a URL somebody handed us, and a
 * project pointed at cloud metadata would otherwise be a scheduled internal
 * probe running forever.
 *
 * TWO consecutive failures before an alert, and that rule is the whole
 * difference between a monitoring product and a nuisance. A single timeout is a
 * deploy, a blip, a resolver hiccup — alert on it and the customer filters the
 * sender, after which the message that mattered never arrives either.
 */

import { safeFetch } from '@darvin/checks'
import { consecutiveFailures, recordAlertOnce, recordMonitorRun } from '@darvin/db'
import { deliverAlert } from '@/lib/alert-email.ts'
import { inngest, EVENTS } from '@/lib/inngest.ts'
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
    // No retries: a retry would hide the failure this job exists to observe.
    retries: 0,
  },
  async ({ event, step }) => {
    const { monitorId, projectId, url } = event.data as MonitorDueEvent['data']

    const outcome = await step.run('probe', async () => {
      const startedAt = Date.now()
      try {
        const response = await safeFetch(url, { timeoutMs: PROBE_TIMEOUT_MS, maxBodyBytes: 4096 })
        return {
          ok: response.status < 400,
          statusCode: response.status,
          latencyMs: Date.now() - startedAt,
          detail: response.status < 400 ? null : `HTTP ${response.status}`,
        }
      } catch (error) {
        return {
          ok: false,
          statusCode: null,
          latencyMs: Date.now() - startedAt,
          detail: error instanceof Error ? error.message : 'unreachable',
        }
      }
    })

    const result = await step.run('record-and-alert', async () => {
      await recordMonitorRun(monitorId, outcome)

      if (outcome.ok) return { ok: true, alerted: false, streak: 0, alertId: null as string | null }

      const streak = await consecutiveFailures(monitorId)
      if (streak < FAILURES_BEFORE_ALERT) {
        return { ok: false, alerted: false, streak, alertId: null as string | null }
      }

      const alert = await recordAlertOnce({
        projectId,
        kind: 'downtime',
        channel: 'email',
        payload: { url, streak, statusCode: outcome.statusCode, detail: outcome.detail },
      })
      return { ok: false, alerted: alert !== null, streak, alertId: alert?.id ?? null }
    })

    /*
     * Delivery is its OWN step, deliberately.
     *
     * Inngest memoizes a completed step and retries only the one that failed.
     * Folded into the step above, a transient mail failure would retry the
     * whole thing — recordAlertOnce would find today's row already there,
     * return null, and the retry would send nothing. The alert would be lost
     * precisely because we tried to be careful about duplicates.
     */
    const alertId = result.alertId
    if (alertId) await step.run('deliver', () => deliverAlert(alertId))

    return result
  },
)
