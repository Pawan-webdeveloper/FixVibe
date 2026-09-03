/**
 * GET /api/monitors/[id]/incidents
 *
 * Incident history for a monitor, newest first.
 * Returns both open (resolvedAt = null) and resolved incidents.
 * Used to render the incident timeline on the monitor detail page.
 */

import { NextResponse } from 'next/server'
import { listIncidents } from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: Request,
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

  try {
    const incidents = await listIncidents(id, viewer, 50)
    return NextResponse.json({ incidents })
  } catch (error) {
    console.error(`[api/monitors/${id}/incidents] failed to fetch incidents:`, error)
    return NextResponse.json({ error: 'Failed to fetch incidents' }, { status: 500 })
  }
}