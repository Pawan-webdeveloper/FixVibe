/**
 * How long until the certificate stops working.
 *
 * The highest-value alert in the product for the least work. An expired
 * certificate takes a site down completely — every browser refuses it, with a
 * full-page warning — and it happens to people who simply forgot, which is
 * exactly the failure a reminder prevents.
 *
 * Only the TLS handshake runs, not a scan. A daily full scan of every monitored
 * site to read one date would be a great deal of somebody else's bandwidth for
 * a number that takes a handshake to learn.
 */

import { getTlsInfo } from '@scanlyfix/checks'
import { recordAlertOnce } from '@scanlyfix/db'
import { deliverAlert } from '@/lib/alert-email.ts'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import type { MonitorDueEvent } from './types.ts'

/**
 * Descending, and the first match wins. Thirty days is time to renew calmly,
 * seven is time to renew today — and a certificate that has already expired is
 * a different message, because the site is down right now.
 */
const THRESHOLD_DAYS = [30, 14, 7, 3, 1]

const DAY_MS = 86_400_000

export const domainHealth = inngest.createFunction(
  {
    id: 'monitor-domain-health',
    triggers: [{ event: EVENTS.monitorDue, if: 'event.data.type == "domain"' }],
    concurrency: { limit: 20 },
    retries: 1,
  },
  async ({ event, step }) => {
    const { monitorId, projectId, url } = event.data as MonitorDueEvent['data']

    const reading = await step.run('read-certificate', async () => {
      let host: URL
      try {
        host = new URL(url)
      } catch {
        return { ok: false, daysLeft: null, detail: 'unparseable project URL' }
      }
      if (host.protocol !== 'https:') {
        // Nothing to expire. Not a failure — the https-redirect check owns that.
        return { ok: true, daysLeft: null, detail: 'not served over https' }
      }

      const tls = await getTlsInfo(host.hostname, host.port ? Number(host.port) : 443)
      if (!tls) return { ok: false, daysLeft: null, detail: 'TLS handshake failed' }

      return {
        ok: true,
        daysLeft: Math.floor((tls.validTo.getTime() - Date.now()) / DAY_MS),
        detail: null as string | null,
      }
    })

    const result = await step.run('record-and-alert', async () => {
      // WHY no recordMonitorRun: monitoring-probe.ts already records the run
      // for this monitor. Calling it here would overwrite lastStatus.
      // domain-health.ts only handles granular certificate expiry alerting.

      const daysLeft = reading.daysLeft
      if (daysLeft === null) {
        return {
          alerted: false,
          daysLeft: null as number | null,
          reason: reading.detail ?? 'no certificate',
          alertId: null as string | null,
        }
      }

      const threshold = daysLeft < 0 ? 0 : THRESHOLD_DAYS.find((days) => daysLeft <= days)
      if (threshold === undefined) {
        return { alerted: false, daysLeft, reason: 'above every threshold', alertId: null as string | null }
      }

      const alert = await recordAlertOnce({
        projectId,
        // The threshold is part of the kind, so crossing 30 and later 7 are two
        // different alerts rather than one that the day's dedup swallows.
        kind: `certificate-expiry-${threshold}`,
        channel: 'email',
        payload: { url, daysLeft, expired: daysLeft < 0 },
      })
      return { alerted: alert !== null, daysLeft, reason: null, alertId: alert?.id ?? null }
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
