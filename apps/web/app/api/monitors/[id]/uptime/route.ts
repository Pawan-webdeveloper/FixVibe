/**
 * GET /api/monitors/[id]/uptime?period=24h|7d|30d
 *
 * Uptime percentage for a monitor over the requested period.
 * Defaults to 24h when no period is supplied.
 *
 * Response:
 *   { total: number, up: number, down: number, uptimePercent: number }
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const raw = searchParams.get('period') ?? '24h'

  if (!isPeriod(raw)) {
    return NextResponse.json(
      { error: `Invalid period. Use one of: ${VALID_PERIODS.join(', ')}` },
      { status: 400 },
    )
  }

  const uptime = await getUptime(id, viewer, raw)
  return NextResponse.json(uptime)
}