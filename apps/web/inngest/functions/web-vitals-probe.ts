/**
 * web-vitals-probe.ts
 *
 * Handles `scanlyfix/monitor.due` events where `type == "web_vitals"`.
 *
 * Flow:
 *   Step 1 — PSI API call (slow, 30-60s) — isolated step so retry is cheap
 *   Step 2 — DB snapshot insert + threshold evaluation + recordAlertOnce
 *   Step 3 — Alert delivery (per alert, same pattern as monitoring-probe.ts)
 *
 * WHY retries: 0
 *   PSI failure ek check miss karna hai — next scheduled run catch karega.
 *   Retry se duplicate snapshots aa sakte hain.
 *
 * WHY concurrency: 5 (not 10 like monitoring-probe)
 *   PSI calls 30-60s tak le sakti hain — higher concurrency = rate limit hit.
 */

import { recordAlertOnce } from '@scanlyfix/db'
import { recordWebVitalsSnapshot } from '@scanlyfix/db/queries/web-vitals.ts'
import { deliverAlert } from '@/lib/alert-email.ts'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import { checkWebVitals } from '@scanlyfix/checks'
import { evaluateVitals, formatVitalValue } from '@/lib/web-vitals-thresholds.ts'
import type { MonitoringDueEvent } from './types.ts'

/* ------------------------------------------------------------------ */
/* Inngest Function                                                      */
/* ------------------------------------------------------------------ */

export const webVitalsProbe = inngest.createFunction(
  {
    id: 'monitor-web-vitals',
    triggers: [{ event: EVENTS.monitorDue, if: 'event.data.type == "web_vitals"' }],
    concurrency: { limit: 5 },
    // WHY 0 retries: monitoring-probe.ts ki same philosophy —
    // retry = hide the failure we exist to observe
    retries: 0,
  },
  async ({ event, step }) => {
    const { monitorId, projectId, url } = event.data as MonitoringDueEvent['data']

    /* ── Step 1: PSI Fetch ───────────────────────────────────────────
     *
     * WHY isolated step:
     * PSI 30-60s leti hai. Agar Step 2 (DB write) fail ho toh
     * Inngest sirf Step 2 retry karega — PSI dobara call nahi hoga.
     * Network cost save hoti hai.
     */
    const vitalsResult = await step.run('fetch-web-vitals', async () => {
      return checkWebVitals(url)
    })

    /* ── Step 2: Snapshot + Evaluate + Alert ─────────────────────────
     *
     * WHY sab ek step mein:
     * Snapshot insert aur alert ek atomic unit hain.
     * Agar alag steps mein hote:
     *   - Snapshot insert ho, alert record fail ho → alert miss
     *   - Retry pe snapshot duplicate ho jata
     */
    const alertId = await step.run('record-and-alert', async () => {
      // PSI call fail hui — log karo, alert mat bhejo
      // WHY no alert: transient PSI error ≠ site performance issue
      if (!vitalsResult.ok) {
        console.warn(
          `[web-vitals] PSI fetch failed for ${url}: ${vitalsResult.detail}`,
        )
        return null
      }

      // Snapshot save karo
      await recordWebVitalsSnapshot(monitorId, {
        lcp: vitalsResult.lcp,
        fid: vitalsResult.fid,
        cls: vitalsResult.cls,
        fcp: vitalsResult.fcp,
        ttfb: vitalsResult.ttfb,
        si: vitalsResult.si,
      })

      // Thresholds evaluate karo
      const { violations, hasCritical } = evaluateVitals({
        lcp: vitalsResult.lcp,
        fid: vitalsResult.fid,
        cls: vitalsResult.cls,
        fcp: vitalsResult.fcp,
        ttfb: vitalsResult.ttfb,
        si: vitalsResult.si,
      })

      // Koi violation nahi — sab theek hai
      if (violations.length === 0) return null

      // Alert record karo
      // WHY recordAlertOnce: agar same violations next run mein bhi hain
      // toh duplicate alert nahi jayega
      const alert = await recordAlertOnce({
        projectId,
        kind: 'web_vitals',
        channel: 'email',
        payload: {
          url,
          violations,
          hasCritical,
          // WHY summary: alert message mein directly use hoga
          summary: violations
            .map((v) => `${v.metric} ${formatVitalValue(v.key, v.value)}`)
            .join(', '),
        },
      })

      return alert?.id ?? null
    })

    /* ── Step 3: Deliver Alert ───────────────────────────────────────
     *
     * WHY alag step (same reason as monitoring-probe.ts):
     * Mail delivery fail ho toh sirf delivery retry ho —
     * PSI fetch + DB write dobara na ho.
     */
    if (alertId) {
      await step.run(`deliver-${alertId}`, () => deliverAlert(alertId))
    }

    return {
      ok: vitalsResult.ok,
      vitals: vitalsResult.ok
        ? {
            lcp: vitalsResult.lcp,
            fid: vitalsResult.fid,
            cls: vitalsResult.cls,
            fcp: vitalsResult.fcp,
            ttfb: vitalsResult.ttfb,
            si: vitalsResult.si,
          }
        : null,
      alerted: alertId !== null,
      alertId,
    }
  },
)