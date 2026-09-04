/**
 * apps/web/app/api/incidents/[id]/ack/route.ts
 *
 * POST /api/incidents/:id/ack
 *
 * Mark an incident as "I am on it". Idempotent — re-acking updates the
 * timestamp and acknowledger, so a hand-off is visible in the audit trail.
 *
 * Body: none. The current viewer is the acknowledger.
 *
 * Returns:
 *   200 { incident }                 — full updated row, including
 *                                     acknowledgerEmail for the UI badge
 *   401 { error: 'Unauthorized' }    — anonymous viewer
 *   404 { error: 'Incident not found' } — wrong id, or no ownership
 *
 * The route has no body to validate. The Viewer comes from the session,
 * and the incident id is the URL param. Zod-validating an empty body would
 * be theatre.
 */

import { NextResponse } from 'next/server'
import { acknowledgeIncident } from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(_request: Request, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const incident = await acknowledgeIncident(id, viewer)

  if (!incident) {
    return NextResponse.json({ error: 'Incident not found' }, { status: 404 })
  }

  return NextResponse.json({ incident })
}
