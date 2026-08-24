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

import { getTlsInfo } from '@darvin/checks'
import { recordAlertOnce, recordMonitorRun } from '@darvin/db'
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

    return step.run('record-and-alert', async () => {
      await recordMonitorRun(monitorId, { ok: reading.ok, detail: reading.detail })

      const daysLeft = reading.daysLeft
      if (daysLeft === null) return { alerted: false, reason: reading.detail ?? 'no certificate' }

      const threshold = daysLeft < 0 ? 0 : THRESHOLD_DAYS.find((days) => daysLeft <= days)
      if (threshold === undefined) return { alerted: false, daysLeft }

      const alert = await recordAlertOnce({
        projectId,
        // The threshold is part of the kind, so crossing 30 and later 7 are two
        // different alerts rather than one that the day's dedup swallows.
        kind: `certificate-expiry-${threshold}`,
        channel: 'email',
        payload: { url, daysLeft, expired: daysLeft < 0 },
      })
      return { alerted: alert !== null, daysLeft, threshold }
    })
  },
)
