/**
 * Rollup queries for monitor events.
 *
 * Aggregates raw events into hourly and daily rollups for fast queries.
 * Used by the rollup-worker Inngest function.
 */

import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '../client.ts'
import {
  monitorEvents,
  monitorHourlyRollups,
  monitorDailyRollups,
  monitors,
} from '../schema.ts'

/**
 * Aggregates raw events for a specific hour into the hourly rollup table.
 *
 * Uses UPSERT (INSERT ... ON CONFLICT) for idempotency — re-running the
 * aggregation for the same hour will update, not duplicate.
 *
 * @param hour - The hour to aggregate (truncated to hour boundary)
 * @returns Number of monitors processed
 */
export async function aggregateHourlyRollup(hour: Date): Promise<{ monitorsProcessed: number }> {
  // Truncate to hour boundary
  const hourTruncated = new Date(hour)
  hourTruncated.setMinutes(0, 0, 0)

  const nextHour = new Date(hourTruncated)
  nextHour.setHours(nextHour.getHours() + 1)

  // Aggregate raw events for this hour
  const aggregated = await db.execute<{
    monitor_id: string
    total_checks: number
    up_checks: number
    avg_latency_ms: number | null
    p95_latency_ms: number | null
    min_latency_ms: number | null
    max_latency_ms: number | null
  }>(sql`
    INSERT INTO monitor_hourly_rollups (
      monitor_id, hour, total_checks, up_checks,
      avg_latency_ms, p95_latency_ms, min_latency_ms, max_latency_ms
    )
    SELECT
      monitor_id,
      ${hourTruncated} AS hour,
      COUNT(*)::int AS total_checks,
      COUNT(*) FILTER (WHERE ok)::int AS up_checks,
      AVG(latency_ms)::int AS avg_latency_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95_latency_ms,
      MIN(latency_ms) AS min_latency_ms,
      MAX(latency_ms) AS max_latency_ms
    FROM monitor_events
    WHERE ts >= ${hourTruncated}
      AND ts < ${nextHour}
    GROUP BY monitor_id
    ON CONFLICT (monitor_id, hour)
    DO UPDATE SET
      total_checks = EXCLUDED.total_checks,
      up_checks = EXCLUDED.up_checks,
      avg_latency_ms = EXCLUDED.avg_latency_ms,
      p95_latency_ms = EXCLUDED.p95_latency_ms,
      min_latency_ms = EXCLUDED.min_latency_ms,
      max_latency_ms = EXCLUDED.max_latency_ms
    RETURNING monitor_id
  `)

  return { monitorsProcessed: aggregated.rowCount ?? 0 }
}

/**
 * Aggregates raw events for a specific day into the daily rollup table.
 *
 * @param day - The day to aggregate (truncated to day boundary)
 * @returns Number of monitors processed
 */
export async function aggregateDailyRollup(day: Date): Promise<{ monitorsProcessed: number }> {
  // Truncate to day boundary
  const dayTruncated = new Date(day)
  dayTruncated.setHours(0, 0, 0, 0)

  const nextDay = new Date(dayTruncated)
  nextDay.setDate(nextDay.getDate() + 1)

  // Aggregate raw events for this day
  const aggregated = await db.execute<{
    monitor_id: string
    total_checks: number
    up_checks: number
    avg_latency_ms: number | null
    p95_latency_ms: number | null
  }>(sql`
    INSERT INTO monitor_daily_rollups (
      monitor_id, day, total_checks, up_checks,
      avg_latency_ms, p95_latency_ms
    )
    SELECT
      monitor_id,
      ${dayTruncated} AS day,
      COUNT(*)::int AS total_checks,
      COUNT(*) FILTER (WHERE ok)::int AS up_checks,
      AVG(latency_ms)::int AS avg_latency_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95_latency_ms
    FROM monitor_events
    WHERE ts >= ${dayTruncated}
      AND ts < ${nextDay}
    GROUP BY monitor_id
    ON CONFLICT (monitor_id, day)
    DO UPDATE SET
      total_checks = EXCLUDED.total_checks,
      up_checks = EXCLUDED.up_checks,
      avg_latency_ms = EXCLUDED.avg_latency_ms,
      p95_latency_ms = EXCLUDED.p95_latency_ms
    RETURNING monitor_id
  `)

  return { monitorsProcessed: aggregated.rowCount ?? 0 }
}

/**
 * Deletes old raw events in batches.
 *
 * Uses batch delete of 1000 rows to avoid long-running transactions
 * and table locks. Called by the rollup-worker in a loop until no
 * more old events remain.
 *
 * @param batchSize - Number of rows to delete per batch (default 1000)
 * @returns Number of rows deleted in this batch
 */
export async function cleanupOldEvents(batchSize = 1000): Promise<number> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)

  const deleted = await db.execute<{ id: string }>(sql`
    DELETE FROM monitor_events
    WHERE id IN (
      SELECT id FROM monitor_events
      WHERE ts < ${cutoff}
      LIMIT ${batchSize}
    )
    RETURNING id
  `)

  return deleted.rowCount ?? 0
}

/**
 * Uptime result type with latency stats.
 * uptimePercent is null when no events exist (zero-event monitors).
 */
export type UptimeResultWithLatency = {
  total: number
  up: number
  down: number
  uptimePercent: number | null
  avgLatencyMs: number | null
  p95LatencyMs: number | null
}

/**
 * Response time data point for charts.
 */
export type ResponseTimePoint = {
  timestamp: Date
  avgLatencyMs: number | null
  p95LatencyMs: number | null
  maxLatencyMs: number | null
  totalChecks: number
}

/**
 * Gets response time data from hourly rollups.
 *
 * @param monitorId - The monitor to query
 * @param start - Start of time range
 * @param end - End of time range
 * @returns Array of hourly response time data points
 */
export async function getResponseTimesFromHourlyRollups(
  monitorId: string,
  start: Date,
  end: Date,
): Promise<ResponseTimePoint[]> {
  const rows = await db
    .select({
      hour: monitorHourlyRollups.hour,
      avgLatencyMs: monitorHourlyRollups.avgLatencyMs,
      p95LatencyMs: monitorHourlyRollups.p95LatencyMs,
      maxLatencyMs: monitorHourlyRollups.maxLatencyMs,
      totalChecks: monitorHourlyRollups.totalChecks,
    })
    .from(monitorHourlyRollups)
    .where(
      and(
        eq(monitorHourlyRollups.monitorId, monitorId),
        gte(monitorHourlyRollups.hour, start),
        lte(monitorHourlyRollups.hour, end),
      ),
    )
    .orderBy(monitorHourlyRollups.hour)

  return rows.map((row) => ({
    timestamp: row.hour,
    avgLatencyMs: row.avgLatencyMs,
    p95LatencyMs: row.p95LatencyMs,
    maxLatencyMs: row.maxLatencyMs,
    totalChecks: row.totalChecks,
  }))
}

/**
 * Gets response time data from daily rollups.
 *
 * @param monitorId - The monitor to query
 * @param start - Start of time range
 * @param end - End of time range
 * @returns Array of daily response time data points
 */
export async function getResponseTimesFromDailyRollups(
  monitorId: string,
  start: Date,
  end: Date,
): Promise<ResponseTimePoint[]> {
  const rows = await db
    .select({
      day: monitorDailyRollups.day,
      avgLatencyMs: monitorDailyRollups.avgLatencyMs,
      p95LatencyMs: monitorDailyRollups.p95LatencyMs,
      totalChecks: monitorDailyRollups.totalChecks,
    })
    .from(monitorDailyRollups)
    .where(
      and(
        eq(monitorDailyRollups.monitorId, monitorId),
        gte(monitorDailyRollups.day, start),
        lte(monitorDailyRollups.day, end),
      ),
    )
    .orderBy(monitorDailyRollups.day)

  return rows.map((row) => ({
    timestamp: row.day,
    avgLatencyMs: row.avgLatencyMs,
    p95LatencyMs: row.p95LatencyMs,
    maxLatencyMs: row.p95LatencyMs, // No separate max in daily rollups, use p95 as proxy
    totalChecks: row.totalChecks,
  }))
}

/**
 * Gets uptime from hourly rollups for a time range.
 *
 * @param monitorId - The monitor to query
 * @param start - Start of time range
 * @param end - End of time range
 * @returns Uptime statistics with latency from rollups
 */
export async function getUptimeFromHourlyRollups(
  monitorId: string,
  start: Date,
  end: Date,
): Promise<UptimeResultWithLatency> {
  const [result] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${monitorHourlyRollups.totalChecks}), 0)::int`,
      up: sql<number>`COALESCE(SUM(${monitorHourlyRollups.upChecks}), 0)::int`,
      avgLatencyMs: sql<number | null>`ROUND(SUM(${monitorHourlyRollups.avgLatencyMs} * ${monitorHourlyRollups.totalChecks}) / NULLIF(SUM(${monitorHourlyRollups.totalChecks}), 0))`,
      p95LatencyMs: sql<number | null>`MAX(${monitorHourlyRollups.p95LatencyMs})`,
    })
    .from(monitorHourlyRollups)
    .where(
      and(
        eq(monitorHourlyRollups.monitorId, monitorId),
        gte(monitorHourlyRollups.hour, start),
        lte(monitorHourlyRollups.hour, end),
      ),
    )

  const total = result?.total ?? 0
  const up = result?.up ?? 0
  const down = total - up
  const uptimePercent = total === 0 ? null : Math.round((up / total) * 10_000) / 100

  return {
    total,
    up,
    down,
    uptimePercent,
    avgLatencyMs: result?.avgLatencyMs ?? null,
    p95LatencyMs: result?.p95LatencyMs ?? null,
  }
}

/**
 * Gets uptime from daily rollups for a time range.
 *
 * @param monitorId - The monitor to query
 * @param start - Start of time range
 * @param end - End of time range
 * @returns Uptime statistics with latency from rollups
 */
export async function getUptimeFromDailyRollups(
  monitorId: string,
  start: Date,
  end: Date,
): Promise<UptimeResultWithLatency> {
  const [result] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${monitorDailyRollups.totalChecks}), 0)::int`,
      up: sql<number>`COALESCE(SUM(${monitorDailyRollups.upChecks}), 0)::int`,
      avgLatencyMs: sql<number | null>`ROUND(SUM(${monitorDailyRollups.avgLatencyMs} * ${monitorDailyRollups.totalChecks}) / NULLIF(SUM(${monitorDailyRollups.totalChecks}), 0))`,
      p95LatencyMs: sql<number | null>`MAX(${monitorDailyRollups.p95LatencyMs})`,
    })
    .from(monitorDailyRollups)
    .where(
      and(
        eq(monitorDailyRollups.monitorId, monitorId),
        gte(monitorDailyRollups.day, start),
        lte(monitorDailyRollups.day, end),
      ),
    )

  const total = result?.total ?? 0
  const up = result?.up ?? 0
  const down = total - up
  const uptimePercent = total === 0 ? null : Math.round((up / total) * 10_000) / 100

  return {
    total,
    up,
    down,
    uptimePercent,
    avgLatencyMs: result?.avgLatencyMs ?? null,
    p95LatencyMs: result?.p95LatencyMs ?? null,
  }
}

/**
 * Gets daily buckets for the 90-day status page strip from daily rollups.
 *
 * @param monitorId - The monitor to query
 * @param days - Number of days to look back (default 90)
 * @returns Daily buckets with date and ok status
 */
export async function getDailyBucketsFromRollups(
  monitorId: string,
  days = 90,
): Promise<Array<{ date: string; ok: boolean; total: number }>> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  cutoff.setHours(0, 0, 0, 0)

  const rows = await db
    .select({
      date: sql<string>`(${monitorDailyRollups.day} at time zone 'utc')::date::text`,
      total: sql<number>`SUM(${monitorDailyRollups.totalChecks})::int`,
      up: sql<number>`SUM(${monitorDailyRollups.upChecks})::int`,
    })
    .from(monitorDailyRollups)
    .where(
      and(
        eq(monitorDailyRollups.monitorId, monitorId),
        gte(monitorDailyRollups.day, cutoff),
      ),
    )
    .groupBy(sql`(${monitorDailyRollups.day} at time zone 'utc')::date`)
    .orderBy(sql`(${monitorDailyRollups.day} at time zone 'utc')::date`)

  return rows.map((row) => ({
    date: row.date,
    ok: row.up === row.total,
    total: row.total,
  }))
}
