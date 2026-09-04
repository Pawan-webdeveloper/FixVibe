/**
 * apps/web/inngest/functions/auto-resolve-stale-incidents.ts
 *
 * Daily cron: auto-resolve incidents that have been open longer than
 * STALE_INCIDENT_AGE_MS (24h) AND whose monitor is now reporting healthy.
 *
 * Why this exists
 *   A bug in the recovery path, a missed recovery alert, or a
 *   monitor-deleted-while-down can leave an incident row with
 *   resolvedAt = NULL forever. That row then misleads the on-call (a
 *   never-ending incident hides a real one), inflates durationMs, and
 *   keeps an "ongoing" pill in the dashboard for a site that has been
 *   green for a day. The cron is the safety net.
 *
 * Why 24h
 *   Two reasons it cannot be tighter:
 *     1. The recovery probe runs on a per-monitor interval. A site that
 *        fell over an hour before this cron runs and recovered in the
 *        last 30 minutes is, to the cron, "down" — the next probe has
 *        not yet flipped lastStatus to 'up'. A 24h grace period makes
 *        that race impossible: by then the monitor has had at least
 *        one full day of checks, all of them successful.
 *     2. The on-call is human. 24h is two working shifts. If a real
 *        outage is somehow being masked by the cron, the human has
 *        noticed by then and either ack'd the incident (the cron
 *        does not touch acknowledged rows… actually it does, since
 *        "ack" is not "resolve", and a row that is ack'd-and-stale is
 *        still stale) or paused the monitor.
 *
 * What it does NOT do
 *   - It does not send any notification. The user already saw the
 *     initial downtime alert; an "auto-resolved" notification would
 *     be noise.
 *   - It does not change acknowledgedBy/acknowledgedAt. The audit
 *     trail (who first ack'd) is preserved on the row.
 *   - It does not re-touch resolved rows. The WHERE re-checks
 *     resolvedAt IS NULL inside the UPDATE for safety.
 */

import {
  findStaleOpenIncidents,
  autoResolveStaleIncident,
} from '@scanlyfix/db'
import { inngest } from '@/lib/inngest.ts'

/**
 * 24h after the previous day's run, plus a small offset so it does not
 * race the rollup worker (which also runs hourly). 02:30 UTC is a
 * dead zone for most customer activity.
 */
const CRON = '30 2 * * *'

/** Cap per run so a multi-thousand-row backlog finishes inside one window. */
const BATCH_LIMIT = 500

export const autoResolveStaleIncidents = inngest.createFunction(
  {
    id: 'auto-resolve-stale-incidents',
    triggers: [{ cron: CRON }],
  },
  async ({ step }) => {
    // Step 1: find candidates. Pure read, isolated for retry safety —
    // a transient DB blip can re-run this without side effects.
    const candidates = await step.run('find-stale', () =>
      findStaleOpenIncidents({ limit: BATCH_LIMIT }),
    )

    if (candidates.length === 0) {
      return { scanned: 0, resolved: 0, skipped: 0 }
    }

    // Step 2: resolve each row. Each update is its own step so a single
    // bad row does not roll back the whole batch.
    let resolved = 0
    let skipped = 0
    for (const c of candidates) {
      const ok = await step.run(`resolve-${c.id}`, () =>
        autoResolveStaleIncident(c.id),
      )
      if (ok) resolved++
      else skipped++ // Lost a race — the real recovery closed it first.
    }

    return {
      scanned: candidates.length,
      resolved,
      skipped,
    }
  },
)
