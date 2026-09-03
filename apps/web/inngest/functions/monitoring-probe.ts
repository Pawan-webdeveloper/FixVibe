import {
  recordAlertOnce,
  recordMonitorRun,
  checkDns,
  diffDnsRecords,
  getLatestDnsSnapshot,
  recordDnsSnapshot,
} from '@scanlyfix/db'
import { deliverAlert } from '@/lib/alert-email.ts'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import { checkSsl, checkDomain } from '@scanlyfix/checks'

import type { MonitoringDueEvent } from './types.ts'

const SSL_WARN_DAYS = 14
const DOMAIN_WARN_DAYS = 30

export const monitoringProbe = inngest.createFunction(
  {
    id: 'monitor-monitoring',
    triggers: [{ event: EVENTS.monitorDue, if: 'event.data.type == "domain"' }],
    concurrency: { limit: 10 },
    retries: 0,
  },
  async ({ event, step }) => {
    const { monitorId, projectId, url } = event.data as MonitoringDueEvent['data']
    const hostname = new URL(url).hostname

    /* ── Step 1: SSL check ───────────────────────────────────────── */
    // ✅ EXISTING — touch mat karo
    const sslResult = await step.run('check-ssl', async () => {
      return checkSsl(hostname)
    })

    /* ── Step 2: Domain check ────────────────────────────────────── */
    // ✅ EXISTING — touch mat karo
    const domainResult = await step.run('check-domain', async () => {
      return checkDomain(hostname)
    })

    /* ── Step 3: Record run + evaluate alerts ────────────────────── */
    // ✅ EXISTING — touch mat karo
    const result = await step.run('record-and-alert', async () => {
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

      if (sslResult.daysUntilExpiry !== null && sslResult.daysUntilExpiry <= SSL_WARN_DAYS) {
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

      if (domainResult.daysUntilExpiry !== null && domainResult.daysUntilExpiry <= DOMAIN_WARN_DAYS) {
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

      return { ok: overallOk, alertIds }
    })

    // ✅ EXISTING — deliver SSL/domain alerts
    for (const alertId of result.alertIds) {
      await step.run(`deliver-${alertId}`, () => deliverAlert(alertId))
    }

    // ─── NEW STEPS START HERE ─────────────────────────────────────────────────

    /* ── Step 4: DNS fetch ───────────────────────────────────────────
     *
     * WHY separate step: Inngest ek completed step ko memoize karta hai.
     * Agar Step 5 (alert/DB write) fail ho toh retry sirf wahi step
     * re-run karega — DNS lookup dobara nahi hoga. Network call save.
     */
    const dnsResult = await step.run('check-dns', async () => {
      return checkDns(hostname)
    })

    /* ── Step 5: DNS diff → snapshot → alert ────────────────────────
     *
     * WHY ek step mein sab: getLatestDnsSnapshot + diff + recordDnsSnapshot
     * ek atomic unit hai. Inhe alag steps mein todne se race condition
     * aa sakti hai — do parallel probes ek hi snapshot read kar lein.
     */
    const dnsAlertId = await step.run('record-dns-and-alert', async () => {
      // DNS lookup hi fail hua — transient error, skip karo
      // WHY no alert: single DNS failure = network blip, not a real drift
      if (!dnsResult.ok) {
        console.warn(`[dns-checker] Lookup failed for ${hostname}: ${dnsResult.error}`)
        return null
      }

      const previous = await getLatestDnsSnapshot(monitorId)

      if (previous === null) {
        // Pehli baar check ho raha hai — baseline set karo, alert nahi
        await recordDnsSnapshot(monitorId, dnsResult.records)
        return null
      }

      const diff = diffDnsRecords(previous, dnsResult.records)

      if (!diff.changed) {
        // Records same hain — snapshot update karo, alert nahi
        await recordDnsSnapshot(monitorId, dnsResult.records)
        return null
      }

      // Drift detected — pehle alert record karo, phir snapshot update karo
      // WHY is order mein: agar recordDnsSnapshot ke baad crash ho toh
      // next run mein naya snapshot baseline ban jaata aur drift miss ho jaata
      const alert = await recordAlertOnce({
        projectId,
        kind: 'dns_drift',
        channel: 'email',
        payload: {
          url,
          hostname,
          added: diff.added,
          removed: diff.removed,
        },
      })

      await recordDnsSnapshot(monitorId, dnsResult.records)

      return alert?.id ?? null
    })

    /* ── Deliver DNS alert (same pattern as SSL/domain above) ────── */
    if (dnsAlertId) {
      // WHY separate step: deliver fail ho toh sirf email retry ho,
      // poora probe + DB write chain dobara na chale
      await step.run(`deliver-${dnsAlertId}`, () => deliverAlert(dnsAlertId))
    }

    // ─── NEW STEPS END ────────────────────────────────────────────────────────

    return {
      ok: result.ok,
      ssl: {
        daysUntilExpiry: sslResult.daysUntilExpiry,
        expiresAt: sslResult.expiresAt,
      },
      domain: {
        daysUntilExpiry: domainResult.daysUntilExpiry,
        expiresAt: domainResult.expiresAt,
      },
      // NEW
      dns: {
        ok: dnsResult.ok,
        records: dnsResult.records,
        alerted: dnsAlertId !== null,
      },
      alertIds: [...result.alertIds, ...(dnsAlertId ? [dnsAlertId] : [])],
    }
  },
)

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function buildDetail(sslDays: number | null, domainDays: number | null): string | null {
  const parts: string[] = []
  if (sslDays !== null && sslDays <= SSL_WARN_DAYS) parts.push(`SSL expires in ${sslDays}d`)
  if (domainDays !== null && domainDays <= DOMAIN_WARN_DAYS) parts.push(`Domain expires in ${domainDays}d`)
  return parts.length > 0 ? parts.join(' · ') : null
}