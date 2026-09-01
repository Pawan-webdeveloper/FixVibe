/**
 * GET /api/monitors/[id]/logs
 *
 * Last 100 check events for a monitor — latency, status code, ok/fail.
 * Used to render the check history table and response time graph.
 */
 
import { NextResponse } from 'next/server'
import { recentEvents } from '@scanlyfix/db'
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
  const logs = await recentEvents(id, viewer, 100)
  return NextResponse.json({ logs })
}