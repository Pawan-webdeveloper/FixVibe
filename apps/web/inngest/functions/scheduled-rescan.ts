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

import { recentScansForScheduler, recordAlertOnce, recordMonitorRun } from '@darvin/db'
import type { Category } from '@darvin/checks'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import { runScanJob } from '@/lib/scan/run-scan-job.ts'
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

    const scanId = await step.run('scan', () => runScanJob({ url, profile: 'fast', projectId }))

    return step.run('record-and-alert', async () => {
      const [row] = await recentScansForScheduler(projectId, 1)
      const latest = snapshot(row)

      await recordMonitorRun(monitorId, {
        ok: latest?.status === 'done',
        detail: latest?.status === 'failed' ? (latest.error ?? 'scan failed') : null,
      })

      if (!comparable(latest, previous)) {
        return { scanId, alerted: false, reason: 'coverage-changed' }
      }

      const before = previous!.overall!
      const after = latest!.overall!

      // Only a drop is worth interrupting somebody for. An improvement is good
      // news, and good news can wait until they look.
      if (after >= before) return { scanId, alerted: false, reason: 'no-regression' }

      const alert = await recordAlertOnce({
        projectId,
        kind: 'score-drop',
        channel: 'email',
        payload: { scanId, before, after, delta: after - before },
      })

      return { scanId, alerted: alert !== null, before, after }
    })
  },
)
