/**
 * GET /api/monitors
 *
 * Returns every monitor across all projects owned by the signed-in user.
 * Used by the main monitoring dashboard to render the unified list.
 */

import { NextResponse } from 'next/server'
import { listMonitorsForUser } from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'
 
export const runtime = 'nodejs'
 
export async function GET() {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
 
  const monitors = await listMonitorsForUser(viewer)
  return NextResponse.json({ monitors })
}