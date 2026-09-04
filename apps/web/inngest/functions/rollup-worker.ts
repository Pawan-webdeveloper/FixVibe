/**
 * Rollup worker: aggregates raw monitor events into hourly and daily rollups.
 *
 * Runs hourly via cron. Performs three tasks:
 *   1. Aggregate previous hour's raw events → hourly rollup upsert
 *   2. If day changed: aggregate previous day's raw events → daily rollup upsert
 *   3. Delete raw events older than 90 days (batch delete of 1000, loop)
 *
 * Design:
 *   - Uses UPSERT (INSERT ... ON CONFLICT) for idempotency
 *   - Batch deletes to avoid long-running transactions
 *   - Each step is isolated for retry safety
 */

import { inngest } from '@/lib/inngest.ts'
import {
  aggregateHourlyRollup,
  aggregateDailyRollup,
  cleanupOldEvents,
} from '@scanlyfix/db'

/**
 * Hourly cron. Aggregates raw events into rollups and cleans up old data.
 */
export const rollupWorker = inngest.createFunction(
  { id: 'rollup-worker', triggers: [{ cron: '5 * * * *' }] }, // Run at :05 past each hour
  async ({ step }) => {
    const now = new Date()
    const results = {
      hourlyRollups: 0,
      dailyRollups: 0,
      eventsDeleted: 0,
    }

    // Step 1: Aggregate previous hour's events into hourly rollup
    const previousHour = new Date(now)
    previousHour.setHours(previousHour.getHours() - 1)
    previousHour.setMinutes(0, 0, 0)

    const hourlyResult = await step.run('aggregate-hourly', () =>
      aggregateHourlyRollup(previousHour),
    )
    results.hourlyRollups = hourlyResult.monitorsProcessed

    // Step 2: If we're past midnight (hour 0-5), aggregate previous day
    // The "5 * * * *" cron means we run at :05 past each hour
    // At hour 5 (5:05 AM), we aggregate the previous day
    if (now.getHours() === 5) {
      const previousDay = new Date(now)
      previousDay.setDate(previousDay.getDate() - 1)
      previousDay.setHours(0, 0, 0, 0)

      const dailyResult = await step.run('aggregate-daily', () =>
        aggregateDailyRollup(previousDay),
      )
      results.dailyRollups = dailyResult.monitorsProcessed
    }

    // Step 3: Clean up raw events older than 90 days
    // Batch delete of 1000 rows at a time to avoid locking
    let deleted = 0
    for (let i = 0; i < 100; i++) { // Max 100 iterations = 100k rows per run
      const batchDeleted = await step.run(`cleanup-batch-${i}`, () =>
        cleanupOldEvents(1000),
      )
      deleted += batchDeleted
      if (batchDeleted < 1000) break // No more old events
    }
    results.eventsDeleted = deleted

    return results
  },
)
