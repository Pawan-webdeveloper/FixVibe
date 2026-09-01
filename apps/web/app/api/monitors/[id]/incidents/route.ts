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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const incidents = await listIncidents(id, viewer, 50)
  return NextResponse.json({ incidents })
}