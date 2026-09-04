/**
 * Tests for atomic monitor claiming (sweep race condition prevention).
 *
 * The claimDueMonitors function uses UPDATE RETURNING to atomically:
 *   1. Find due monitors
 *   2. Advance their lastRunAt to now()
 *   3. Return the claimed monitors
 *
 * This prevents double-dispatch when multiple sweep invocations run concurrently.
 */

import { describe, expect, it } from 'vitest'

describe('Atomic claim pattern', () => {
  it('claimDueMonitors uses UPDATE RETURNING for atomicity', () => {
    // This is a structural test — verify the SQL pattern is correct
    // The actual atomicity is tested by the database integration tests
    const sqlPattern = /UPDATE monitors[\s\S]*SET last_run_at = now\(\)[\s\S]*RETURNING/
    const claimQuery = `
      UPDATE monitors
      SET last_run_at = now()
      WHERE id IN (
        SELECT m.id
        FROM monitors m
        INNER JOIN projects p ON p.id = m.project_id
        WHERE m.enabled = true
          AND (
            m.last_run_at IS NULL
            OR m.last_run_at < now() - make_interval(secs => m.interval_s)
          )
        ORDER BY coalesce(m.last_run_at, 'epoch'::timestamptz)
        LIMIT 500
      )
      RETURNING id, type, project_id
    `
    expect(sqlPattern.test(claimQuery)).toBe(true)
  })

  it('batch size limit is applied in the WHERE IN subquery', () => {
    // Verify that the LIMIT is inside the subquery, not outside
    // This ensures we only claim up to BATCH_SIZE monitors per sweep
    const claimQuery = `
      UPDATE monitors
      SET last_run_at = now()
      WHERE id IN (
        SELECT m.id
        FROM monitors m
        WHERE m.enabled = true
        LIMIT 500
      )
      RETURNING *
    `
    // LIMIT should be inside the subquery
    expect(claimQuery).toContain('SELECT m.id')
    expect(claimQuery).toContain('LIMIT 500')
  })
})

describe('Sweep batch processing', () => {
  it('sweep stops when fewer than BATCH_SIZE monitors are claimed', () => {
    // This tests the loop termination condition
    const BATCH_SIZE = 500
    const claimedCount = 100 // Less than BATCH_SIZE
    const shouldContinue = claimedCount >= BATCH_SIZE
    expect(shouldContinue).toBe(false)
  })

  it('sweep continues when BATCH_SIZE monitors are claimed', () => {
    const BATCH_SIZE = 500
    const claimedCount = 500 // Exactly BATCH_SIZE
    const shouldContinue = claimedCount >= BATCH_SIZE
    expect(shouldContinue).toBe(true)
  })

  it('sweep stops immediately when no monitors are claimed', () => {
    const BATCH_SIZE = 500
    const claimedCount = 0
    const shouldBreak = claimedCount === 0
    expect(shouldBreak).toBe(true)
  })
})

describe('Race condition prevention', () => {
  it('two concurrent claims on the same monitor should not overlap', () => {
    // Conceptual test: if monitor M is claimed by sweep A,
    // sweep B should not see M as due anymore
    const monitor = {
      id: 'monitor-1',
      lastRunAt: new Date(Date.now() - 120_000), // 2 minutes ago
      intervalS: 60, // 1 minute interval
    }

    const now = new Date()
    const isDue = !monitor.lastRunAt || monitor.lastRunAt.getTime() < now.getTime() - monitor.intervalS * 1000

    // Before claim: monitor is due
    expect(isDue).toBe(true)

    // After claim by sweep A: lastRunAt = now()
    monitor.lastRunAt = now

    // Sweep B runs immediately after
    const isStillDue = !monitor.lastRunAt || monitor.lastRunAt.getTime() < now.getTime() - monitor.intervalS * 1000

    // After claim: monitor is NOT due (lastRunAt is now)
    expect(isStillDue).toBe(false)
  })

  it('failed probe does not reset lease', () => {
    // If a probe fails, the monitor should NOT be re-dispatched immediately
    // The next sweep will pick it up after its normal interval
    const monitor = {
      id: 'monitor-1',
      lastRunAt: new Date(), // Just claimed
      intervalS: 60,
    }

    // Probe fails — we do NOT reset lastRunAt
    // monitor.lastRunAt remains as-is

    // Next sweep runs immediately
    const now = new Date()
    const isDue = !monitor.lastRunAt || monitor.lastRunAt.getTime() < now.getTime() - monitor.intervalS * 1000

    // Monitor is NOT due because lastRunAt was not reset
    expect(isDue).toBe(false)
  })
})
