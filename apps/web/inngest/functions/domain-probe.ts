/**
 * Unified domain probe — single function for all domain monitoring.
 *
 * Replaces: monitoring-probe.ts + domain-health.ts
 *
 * Flow:
 *   Step 1 — SSL certificate check (single TLS handshake)
 *   Step 2 — Domain registration check
 *   Step 3 — Record run + evaluate certificate/domain expiry alerts
 *   Step 4 — DNS fetch
 *   Step 5 — DNS diff → snapshot → alert
 *
 * Alert kinds (threshold-based):
 *   - certificate-expiry-{30|14|7|3|1} — SSL certificate expiry
 *   - domain-expiry-{30|14|7|3|1} — Domain registration expiry
 *   - dns_drift — DNS record changes
 *
 * WHY single function:
 *   - Prevents double SSL checks (was happening with two functions)
 *   - Single recordMonitorRun call (no lastStatus conflicts)
 *   - Simplified Inngest function list
 *
 * Snooze behavior:
 *   - Probe ALWAYS runs (data continuity)
 *   - Snooze ONLY suppresses alert dispatch
 */

import {
  recordAlertOnce,
  recordMonitorRun,
  checkDns,
  diffDnsRecords,
  getLatestDnsSnapshot,
  recordDnsSnapshot,
  isMonitorSnoozed,
} from '@scanlyfix/db'
import { deliverAlert } from '@/lib/alert-email.ts'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import { checkSsl, checkDomain } from '@scanlyfix/checks'

import type { MonitoringDueEvent } from './types.ts'

/**
 * Certificate expiry threshold ladder (descending).
 * First match wins: 30 days = time to renew calmly, 1 = renew today.
 * Negative daysLeft = already expired (threshold 0).
 */
const CERT_THRESHOLD_DAYS = [30, 14, 7, 3, 1]

/**
 * Domain expiry threshold ladder (same pattern as certificate).
 */
const DOMAIN_THRESHOLD_DAYS = [30, 14, 7, 3, 1]

/** Days below which domain expiry is considered urgent */
const DOMAIN_URGENT_DAYS = 7

export const domainProbe = inngest.createFunction(
  {
    id: 'monitor-domain',
    triggers: [{ event: EVENTS.monitorDue, if: 'event.data.type == "domain"' }],
    concurrency: { limit: 10 },
    retries: 0,
  },
  async ({ event, step }) => {
    const { monitorId, projectId, url } = event.data as MonitoringDueEvent['data']

    let hostname: string
    try {
      hostname = new URL(url).hostname
    } catch {
      return { ok: false, error: 'unparseable project URL' }
    }

    /* ── Step 1: SSL check ─────────────────────────────────────────
     *
     * Single TLS handshake — this is the ONLY SSL check per domain run.
     * Returns structured expiry info for threshold evaluation.
     */
    const sslResult = await step.run('check-ssl', async () => {
      return checkSsl(hostname)
    })

    /* ── Step 2: Domain check ──────────────────────────────────────
     *
     * Domain registration expiry — separate step so retry is cheap.
     */
    const domainResult = await step.run('check-domain', async () => {
      return checkDomain(hostname)
    })

    /* ── Step 3: Record run + evaluate alerts ──────────────────────
     *
     * CRITICAL: Record event ALWAYS (even when snoozed) to prevent busy-loop.
     * Single recordMonitorRun call — no conflicts with other probes.
     */
    const result = await step.run('record-and-alert', async () => {
      // Determine overall health status
      const sslOk = sslResult.daysUntilExpiry === null || sslResult.daysUntilExpiry > 14
      const domainOk = domainResult.daysUntilExpiry === null || domainResult.daysUntilExpiry > (DOMAIN_THRESHOLD_DAYS[0] ?? 30)
      const overallOk = sslOk && domainOk

      // ALWAYS record the event and advance lastRunAt
      await recordMonitorRun(monitorId, {
        ok: overallOk,
        statusCode: null,
        latencyMs: null,
        detail: buildDetail(sslResult.daysUntilExpiry, domainResult.daysUntilExpiry),
      })

      // ── Snooze check: ONLY suppress alert dispatch ──────────────────
      const snoozed = await isMonitorSnoozed(monitorId)
      if (snoozed) {
        return {
          ok: overallOk,
          alertIds: [] as string[],
          snoozed: true,
          ssl: { daysUntilExpiry: sslResult.daysUntilExpiry },
          domain: { daysUntilExpiry: domainResult.daysUntilExpiry },
        }
      }

      const alertIds: string[] = []

      // ── Certificate expiry alerts (threshold-based) ──────────────────
      if (sslResult.daysUntilExpiry !== null) {
        const daysLeft = sslResult.daysUntilExpiry
        // Negative daysLeft = already expired (use threshold 0)
        // Logic: find the first threshold where daysLeft <= threshold
        // THRESHOLD_DAYS is descending: [30, 14, 7, 3, 1]
        // First match wins: 25 days → 30, 10 days → 30, 5 days → 30
        const threshold = daysLeft < 0 ? 0 : CERT_THRESHOLD_DAYS.find((d) => daysLeft <= d)

        if (threshold !== undefined) {
          const alert = await recordAlertOnce({
            projectId,
            kind: `certificate-expiry-${threshold}`,
            channel: 'email',
            payload: {
              url,
              hostname,
              daysLeft,
              expired: daysLeft < 0,
              expiresAt: sslResult.expiresAt,
              subject: sslResult.subject,
            },
          })
          if (alert) alertIds.push(alert.id)
        }
      }

      // ── Domain expiry alerts (threshold-based) ───────────────────────
      if (domainResult.daysUntilExpiry !== null) {
        const daysLeft = domainResult.daysUntilExpiry
        // Negative daysLeft = already expired (use threshold 0)
        // Logic: find the first threshold where daysLeft <= threshold
        const threshold = daysLeft < 0 ? 0 : DOMAIN_THRESHOLD_DAYS.find((d) => daysLeft <= d)

        if (threshold !== undefined) {
          const alert = await recordAlertOnce({
            projectId,
            kind: `domain-expiry-${threshold}`,
            channel: 'email',
            payload: {
              url,
              hostname,
              daysLeft,
              expired: daysLeft < 0,
              expiresAt: domainResult.expiresAt,
              registrar: domainResult.registrar,
              urgent: daysLeft <= DOMAIN_URGENT_DAYS,
            },
          })
          if (alert) alertIds.push(alert.id)
        }
      }

      return {
        ok: overallOk,
        alertIds,
        snoozed: false,
        ssl: { daysUntilExpiry: sslResult.daysUntilExpiry },
        domain: { daysUntilExpiry: domainResult.daysUntilExpiry },
      }
    })

    // ── Deliver SSL/domain alerts ──────────────────────────────────────
    for (const alertId of result.alertIds) {
      await step.run(`deliver-${alertId}`, () => deliverAlert(alertId))
    }

    /* ── Step 4: DNS fetch ───────────────────────────────────────────
     *
     * WHY separate step: Inngest memoizes completed steps.
     * If Step 5 fails, only Step 5 retries — DNS lookup saved.
     */
    const dnsResult = await step.run('check-dns', async () => {
      return checkDns(hostname)
    })

    /* ── Step 5: DNS diff → snapshot → alert ────────────────────────
     *
     * WHY single step: getLatestDnsSnapshot + diff + recordDnsSnapshot
     * is an atomic unit. Splitting risks race conditions.
     */
    const dnsAlertId = await step.run('record-dns-and-alert', async () => {
      // DNS lookup failed — transient error, skip
      if (!dnsResult.ok) {
        console.warn(`[dns-checker] Lookup failed for ${hostname}: ${dnsResult.error}`)
        return null
      }

      const previous = await getLatestDnsSnapshot(monitorId)

      if (previous === null) {
        // First check — set baseline, no alert
        await recordDnsSnapshot(monitorId, dnsResult.records)
        return null
      }

      const diff = diffDnsRecords(previous, dnsResult.records)

      if (!diff.changed) {
        // Records unchanged — update snapshot, no alert
        await recordDnsSnapshot(monitorId, dnsResult.records)
        return null
      }

      // ── Snooze check: ONLY suppress alert dispatch ──────────────────
      const snoozed = await isMonitorSnoozed(monitorId)
      if (snoozed) {
        // Still update snapshot for data continuity
        await recordDnsSnapshot(monitorId, dnsResult.records)
        return null
      }

      // Drift detected — record alert first, then update snapshot
      // WHY this order: if crash after recordDnsSnapshot, next run
      // treats new snapshot as baseline and misses the drift
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

    /* ── Deliver DNS alert ────────────────────────────────────────────
     * Separate step — delivery failure doesn't re-run probe + DB write.
     */
    if (dnsAlertId) {
      await step.run(`deliver-${dnsAlertId}`, () => deliverAlert(dnsAlertId))
    }

    return {
      ok: result.ok,
      ssl: result.ssl,
      domain: result.domain,
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
  if (sslDays !== null && sslDays <= 14) parts.push(`SSL expires in ${sslDays}d`)
  if (domainDays !== null && domainDays <= 30) parts.push(`Domain expires in ${domainDays}d`)
  return parts.length > 0 ? parts.join(' · ') : null
}
