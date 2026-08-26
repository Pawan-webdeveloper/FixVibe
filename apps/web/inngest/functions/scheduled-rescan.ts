/**
 * Re-scan a monitored project and say what changed.
 *
 * The scan itself is runScanJob — the exact function the public endpoint calls.
 * That is the payoff for the seam built in Phase 2: monitoring adds no scan
 * code at all, and a monitored scan can never disagree with an anonymous one
 * about what a scan is.
 *
 * The diff is where the care goes, because a monitoring product earns its
 * subscription by being believed and the fastest way to lose that is one alert
 * saying a site got worse on a day it did not change.
 */

import { recentScansForScheduler, recordAlertOnce, recordMonitorRun, type ScanProfile } from '@darvin/db'
import type { Category } from '@darvin/checks'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import { runScanJob } from '@/lib/scan/run-scan-job.ts'
import { deliverAlert } from '@/lib/alert-email.ts'
import type { MonitorDueEvent } from './types.ts'

/**
 * The parts of a scan this job compares, and nothing else.
 *
 * Deliberately not the row. Values returned from a step travel as JSON between
 * durable steps, so a Date comes back a string — Inngest types that honestly as
 * JsonifyObject, and it is a real hazard rather than a type nuisance. Returning
 * a small, already-JSON-safe snapshot means what the next step receives is what
 * this one meant to send.
 */
interface ScanSnapshot {
  status: string
  overall: number | null
  engineVersion: string
  profile: string
  degraded: Category[]
  error: string | null
}

function snapshot(scan: {
  status: string
  scores: { overall: number; degraded: Category[] } | null
  engineVersion: string
  profile: string
  error: string | null
} | undefined): ScanSnapshot | null {
  if (!scan) return null
  return {
    status: scan.status,
    overall: scan.scores?.overall ?? null,
    engineVersion: scan.engineVersion,
    profile: scan.profile,
    degraded: scan.scores?.degraded ?? [],
    error: scan.error,
  }
}

/**
 * Two scans are comparable only when the same instrument measured both.
 *
 * A different engine version means checks were added or changed, so the score
 * moved because the ruler did. A degraded pillar means something could not be
 * measured at all. In either case the honest answer is silence, not a number —
 * this is the rule that stops a deploy of ours becoming an alert of theirs.
 */
function comparable(latest: ScanSnapshot | null, previous: ScanSnapshot | null): boolean {
  if (!latest || !previous) return false
  if (latest.overall === null || previous.overall === null) return false
  if (latest.status !== 'done' || previous.status !== 'done') return false
  if (latest.engineVersion !== previous.engineVersion) return false
  if (latest.profile !== previous.profile) return false
  return latest.degraded.length === 0 && previous.degraded.length === 0
}

export const rescanProject = inngest.createFunction(
  {
    id: 'monitor-rescan',
    triggers: [{ event: EVENTS.monitorDue, if: 'event.data.type == "rescan"' }],
    // A scan is seconds of somebody else's bandwidth. Fifty at once is a
    // self-inflicted outage and an unwelcome visit for every target at 03:00.
    concurrency: { limit: 4 },
    retries: 2,
  },
  async ({ event, step }) => {
    const { monitorId, projectId, url } = event.data as MonitorDueEvent['data']

    // Read BEFORE scanning: after the new scan lands it is no longer the
    // previous one, and there is nothing left to compare against.
    const previous = await step.run('previous-scan', async () => {
      const [scan] = await recentScansForScheduler(projectId, 1)
      return snapshot(scan)
    })

    /*
     * Re-scan at the depth the project was last scanned at, not at a hardcoded
     * one. comparable() below refuses to report a delta across a change of
     * profile — correctly, since a deep scan measures things a fast one never
     * looks at — so a scheduler that always ran 'fast' would silence the delta
     * on every project that uses deep scans, forever.
     */
    const profile: ScanProfile = previous?.profile === 'deep' ? 'deep' : 'fast'
    const scanId = await step.run('scan', () => runScanJob({ url, profile, projectId }))

    const result = await step.run('record-and-alert', async () => {
      const [row] = await recentScansForScheduler(projectId, 1)
      const latest = snapshot(row)

      await recordMonitorRun(monitorId, {
        ok: latest?.status === 'done',
        detail: latest?.status === 'failed' ? (latest.error ?? 'scan failed') : null,
      })

      if (!comparable(latest, previous)) {
        return { scanId, alerted: false, reason: 'coverage-changed', alertId: null as string | null }
      }

      const before = previous!.overall!
      const after = latest!.overall!

      // Only a drop is worth interrupting somebody for. An improvement is good
      // news, and good news can wait until they look.
      if (after >= before) {
        return { scanId, alerted: false, reason: 'no-regression', alertId: null as string | null }
      }

      const alert = await recordAlertOnce({
        projectId,
        kind: 'score-drop',
        channel: 'email',
        payload: { scanId, before, after, delta: after - before },
      })

      return { scanId, alerted: alert !== null, reason: null, alertId: alert?.id ?? null }
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
