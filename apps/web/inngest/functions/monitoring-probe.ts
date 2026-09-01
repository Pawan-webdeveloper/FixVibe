
/**
 * Handles `scanlyfix/monitor.due` events where `type == "domain"`.
 *
 * One function, two checks — SSL cert expiry + domain expiry.
 * Both run in the same step so a single monitor row covers both,
 * which matches the schema: one (project, type) row, type = 'domain'.
 *
 * Alert thresholds:
 *   SSL   → alert at 14 days, urgent at 7 days
 *   Domain → alert at 30 days, urgent at 7 days
 *
 * Unlike uptime, there is no streak logic here — a cert that expires
 * in 6 days is not a blip. Alert on the first check that crosses the
 * threshold, and deduplicate with recordAlertOnce (same as uptime).
 */
 

import { recordAlertOnce, recordMonitorRun } from '@scanlyfix/db'
import { deliverAlert } from '@/lib/alert-email.ts'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import { checkSsl, checkDomain } from '@scanlyfix/checks' /* uptime error — replaced hardcoded absolute paths with package import for portability and security */
import type { MonitoringDueEvent } from './types.ts'
 
/* ------------------------------------------------------------------ */
/* Thresholds                                                           */
/* ------------------------------------------------------------------ */
 


/** Alert when SSL cert has fewer than this many days left. */
const SSL_WARN_DAYS = 14
 
/** Alert when domain registration has fewer than this many days left. */
const DOMAIN_WARN_DAYS = 30
 


 
/* ------------------------------------------------------------------ */
/* Inngest function                                                     */
/* ------------------------------------------------------------------ */
 

export const monitoringProbe = inngest.createFunction(
  {
    id: 'monitor-monitoring',
    triggers: [{ event: EVENTS.monitorDue, if: 'event.data.type == "domain"' }],
    concurrency: { limit: 10 },
    // No retries — same reason as uptime: a retry hides the failure we exist
    // to observe, and the next scheduled run will catch a transient error.
    retries: 0,
  },
  async ({ event, step }) => {
    const { monitorId, projectId, url } = event.data as MonitoringDueEvent['data']
 
    // Extract hostname from URL — "https://app.example.com/path" → "app.example.com"
    const hostname = new URL(url).hostname
 
    /* ── Step 1: SSL check ───────────────────────────────────────── */
    const sslResult = await step.run('check-ssl', async () => {
      return checkSsl(hostname)
    })
 
    /* ── Step 2: Domain check ────────────────────────────────────── */
    const domainResult = await step.run('check-domain', async () => {
      return checkDomain(hostname)
    })
 
    /* ── Step 3: Record run + evaluate alerts ────────────────────── */
    const result = await step.run('record-and-alert', async () => {
      // Record the probe run — ok = true unless BOTH checks are critical
      const overallOk =
        (sslResult.daysUntilExpiry === null || sslResult.daysUntilExpiry > SSL_WARN_DAYS) &&
        (domainResult.daysUntilExpiry === null || domainResult.daysUntilExpiry > DOMAIN_WARN_DAYS)
 
      await recordMonitorRun(monitorId, {
        ok: overallOk,
        statusCode: null,
        latencyMs: null,
        detail: buildDetail(sslResult.daysUntilExpiry, domainResult.daysUntilExpiry),
      })
 
      const alertIds: string[] = []
 
      // SSL alert
      if (
        sslResult.daysUntilExpiry !== null &&
        sslResult.daysUntilExpiry <= SSL_WARN_DAYS
      ) {
        const alert = await recordAlertOnce({
          projectId,
          kind: 'tls_expiring',
          channel: 'email',
          payload: {
            url,
            hostname,
            daysUntilExpiry: sslResult.daysUntilExpiry,
            expiresAt: sslResult.expiresAt,
            subject: sslResult.subject,
            urgent: sslResult.daysUntilExpiry <= 7,
          },
        })
        if (alert) alertIds.push(alert.id)
      }
 
      // Domain alert
      if (
        domainResult.daysUntilExpiry !== null &&
        domainResult.daysUntilExpiry <= DOMAIN_WARN_DAYS
      ) {
        const alert = await recordAlertOnce({
          projectId,
          kind: 'domain_expiring',
          channel: 'email',
          payload: {
            url,
            hostname,
            daysUntilExpiry: domainResult.daysUntilExpiry,
            expiresAt: domainResult.expiresAt,
            registrar: domainResult.registrar,
            urgent: domainResult.daysUntilExpiry <= 7,
          },
        })
        if (alert) alertIds.push(alert.id)
      }
 
      return {
        ok: overallOk,
        ssl: {
          daysUntilExpiry: sslResult.daysUntilExpiry,
          expiresAt: sslResult.expiresAt,
          alerted: alertIds.length > 0,
        },
        domain: {
          daysUntilExpiry: domainResult.daysUntilExpiry,
          expiresAt: domainResult.expiresAt,
          alerted: alertIds.length > 0,
        },
        alertIds,
      }
    })
 
    /*
     * Deliver each alert in its own step — same reason as uptime-probe:
     * Inngest memoizes completed steps, so a transient mail failure retries
     * only the delivery step, not the entire probe + recordAlertOnce chain.
     */
    for (const alertId of result.alertIds) {
      await step.run(`deliver-${alertId}`, () => deliverAlert(alertId))
    }
 
    return result
  },
)
 
/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */
 
function buildDetail(
  sslDays: number | null,
  domainDays: number | null,
): string | null {
  const parts: string[] = []
  if (sslDays !== null && sslDays <= SSL_WARN_DAYS) {
    parts.push(`SSL expires in ${sslDays}d`)
  }
  if (domainDays !== null && domainDays <= DOMAIN_WARN_DAYS) {
    parts.push(`Domain expires in ${domainDays}d`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}
 