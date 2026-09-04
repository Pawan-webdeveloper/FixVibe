/**
 * GET /api/monitors/[id]/response-times?range=1h|24h|7d
 *
 * Response time data for charts with different time ranges.
 *   - 1h: Raw events from last hour (60 data points)
 *   - 24h: Hourly rollups (24 data points)
 *   - 7d: Daily rollups (7 data points)
 *
 * Response:
 *   { range, data: Array<{ timestamp, avgLatencyMs, p95LatencyMs, maxLatencyMs, totalChecks }> }
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  db,
  monitorEvents,
  getResponseTimesFromHourlyRollups,
  getResponseTimesFromDailyRollups,
} from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'
import { and, eq, gte, desc } from 'drizzle-orm'

// ─── Query params schema ───────────────────────────────────────────────────────
const RangeSchema = z.enum(['1h', '24h', '7d'])
type Range = z.infer<typeof RangeSchema>

// ─── Response type ─────────────────────────────────────────────────────────────
export type ResponseTimePoint = {
  timestamp: string
  avgLatencyMs: number | null
  p95LatencyMs: number | null
  maxLatencyMs: number | null
  totalChecks: number
}

export type ResponseTimesResponse = {
  range: Range
  data: ResponseTimePoint[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function getRawResponseTimes(
  monitorId: string,
  start: Date,
): Promise<ResponseTimePoint[]> {
  // Fetch raw events from last hour, grouped by minute
  const result = await db.execute<{
    minute: string
    avg_latency_ms: number | null
    p95_latency_ms: number | null
    max_latency_ms: number | null
    total_checks: number
  }>(`
    SELECT
      date_trunc('minute', ts) as minute,
      ROUND(AVG(latency_ms))::int as avg_latency_ms,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int as p95_latency_ms,
      MAX(latency_ms) as max_latency_ms,
      COUNT(*)::int as total_checks
    FROM monitor_events
    WHERE monitor_id = '${monitorId}'
      AND ts >= '${start.toISOString()}'
    GROUP BY date_trunc('minute', ts)
    ORDER BY date_trunc('minute', ts)
  `)

  return result.rows.map((row) => ({
    timestamp: row.minute,
    avgLatencyMs: row.avg_latency_ms,
    p95LatencyMs: row.p95_latency_ms,
    maxLatencyMs: row.max_latency_ms,
    totalChecks: row.total_checks,
  }))
}

async function getHourlyResponseTimes(
  monitorId: string,
  start: Date,
  end: Date,
): Promise<ResponseTimePoint[]> {
  const data = await getResponseTimesFromHourlyRollups(monitorId, start, end)
  return data.map((point) => ({
    timestamp: point.timestamp.toISOString(),
    avgLatencyMs: point.avgLatencyMs,
    p95LatencyMs: point.p95LatencyMs,
    maxLatencyMs: point.maxLatencyMs,
    totalChecks: point.totalChecks,
  }))
}

async function getDailyResponseTimes(
  monitorId: string,
  start: Date,
  end: Date,
): Promise<ResponseTimePoint[]> {
  const data = await getResponseTimesFromDailyRollups(monitorId, start, end)
  return data.map((point) => ({
    timestamp: point.timestamp.toISOString(),
    avgLatencyMs: point.avgLatencyMs,
    p95LatencyMs: point.p95LatencyMs,
    maxLatencyMs: point.maxLatencyMs,
    totalChecks: point.totalChecks,
  }))
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── 1. Auth ───────────────────────────────────────────────────────────────
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. Validate monitorId ─────────────────────────────────────────────────
  const { id } = await params
  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'Invalid monitor ID' }, { status: 400 })
  }

  // ── 3. Parse query params ─────────────────────────────────────────────────
  const { searchParams } = new URL(request.url)
  const rangeParam = searchParams.get('range') ?? '24h'
  const rangeParsed = RangeSchema.safeParse(rangeParam)

  if (!rangeParsed.success) {
    return NextResponse.json(
      { error: 'Invalid range. Use one of: 1h, 24h, 7d' },
      { status: 400 },
    )
  }

  const range = rangeParsed.data

  // ── 4. Calculate time range ───────────────────────────────────────────────
  const now = new Date()
  const start = new Date(now)

  switch (range) {
    case '1h':
      start.setHours(start.getHours() - 1)
      break
    case '24h':
      start.setDate(start.getDate() - 1)
      break
    case '7d':
      start.setDate(start.getDate() - 7)
      break
  }

  // ── 5. Fetch response times ───────────────────────────────────────────────
  try {
    let data: ResponseTimePoint[]

    switch (range) {
      case '1h':
        data = await getRawResponseTimes(id, start)
        break
      case '24h':
        data = await getHourlyResponseTimes(id, start, now)
        break
      case '7d':
        data = await getDailyResponseTimes(id, start, now)
        break
    }

    return NextResponse.json({ range, data })
  } catch (err) {
    console.error('[response-times] Failed to fetch response times:', err)
    return NextResponse.json(
      { error: 'Failed to fetch response times' },
      { status: 500 },
    )
  }
}
