/**
 * GET /api/monitors/[id]/uptime?period=24h|7d|30d
 *
 * Uptime percentage for a monitor over the requested period.
 * Defaults to 24h when no period is supplied.
 *
 * Response:
 *   { total, up, down, uptimePercent, avgLatencyMs, p95LatencyMs }
 */

import { NextResponse } from 'next/server'
import { getUptime } from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'

export const runtime = 'nodejs'

const VALID_PERIODS = ['24h', '7d', '30d'] as const
type Period = (typeof VALID_PERIODS)[number]

function isPeriod(value: string): value is Period {
  return VALID_PERIODS.includes(value as Period)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'Invalid monitor ID' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const raw = searchParams.get('period') ?? '24h'

  if (!isPeriod(raw)) {
    return NextResponse.json(
      { error: `Invalid period. Use one of: ${VALID_PERIODS.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const uptime = await getUptime(id, viewer, raw)
    return NextResponse.json(uptime)
  } catch (error) {
    console.error(`[api/monitors/${id}/uptime] failed to fetch uptime:`, error)
    return NextResponse.json({ error: 'Failed to fetch uptime' }, { status: 500 })
  }
}