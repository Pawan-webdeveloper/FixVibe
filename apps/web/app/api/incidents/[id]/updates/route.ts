/**
 * apps/web/app/api/incidents/[id]/updates/route.ts
 *
 * POST /api/incidents/:id/updates
 *
 * Append a new human message to an incident's public timeline. Auth-gated:
 * the viewer must own the project the incident belongs to.
 *
 * Body: { status: 'investigating'|'identified'|'monitoring'|'resolved',
 *         message: string (1–4000 chars after trim) }
 *
 * Returns:
 *   200 { update }            — the new row, with creatorEmail for the badge
 *   400 { error }             — invalid status or empty / too-long message
 *   401 { error: 'Unauthorized' }
 *   404 { error: 'Incident not found' } — wrong id, or no ownership
 *
 * Side effect: on success, also notifies the project's status-page
 * subscribers (Phase 6.3). Fan-out is parallel + non-throwing —
 * subscriber failures are logged but do not affect the API response.
 */

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import {
  PostIncidentUpdateSchema,
  postIncidentUpdate,
  monitors,
  projects,
  db,
  incidents,
} from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'
import { notifyConfirmedSubscribersForMonitor } from '@/lib/status-subscriber-email.ts'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = PostIncidentUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  const update = await postIncidentUpdate(id, viewer, parsed.data)
  if (!update) {
    return NextResponse.json({ error: 'Incident not found' }, { status: 404 })
  }

  // Fan-out to status-page subscribers. We do not await the result
  // before returning the API response: subscribers do not gate the
  // internal timeline write, and a slow mail provider should not slow
  // down the on-call's UX.
  void fanOutUpdateToSubscribers(id, parsed.data.status, parsed.data.message).catch(
    (error) => {
      console.error('[incident-update] subscriber fan-out failed:', error)
    },
  )

  return NextResponse.json({ update })
}

/**
 * Resolve the monitor + project for the incident's subscribers and email
 * them. Errors are logged, never thrown — the caller already returned the
 * API response by the time this resolves.
 */
async function fanOutUpdateToSubscribers(
  incidentId: string,
  stage: 'investigating' | 'identified' | 'monitoring' | 'resolved',
  message: string,
): Promise<void> {
  const [row] = await db
    .select({
      monitorId: incidents.monitorId,
      projectName: projects.name,
      projectUrl: projects.url,
      projectSlug: projects.slug,
    })
    .from(incidents)
    .innerJoin(monitors, eq(monitors.id, incidents.monitorId))
    .innerJoin(projects, eq(projects.id, monitors.projectId))
    .where(eq(incidents.id, incidentId))
    .limit(1)

  if (!row) return

  await notifyConfirmedSubscribersForMonitor({
    monitorId: row.monitorId,
    email: {
      projectName: row.projectName,
      projectUrl: row.projectUrl,
      projectSlug: row.projectSlug,
      incidentId,
      stage,
      headline: `${stageLabel(stage)} — ${row.projectName}`,
      message,
      isInitial: false,
    },
  })
}

function stageLabel(stage: string): string {
  switch (stage) {
    case 'investigating':
      return 'Investigating'
    case 'identified':
      return 'Identified'
    case 'monitoring':
      return 'Monitoring'
    case 'resolved':
      return 'Resolved'
    default:
      return 'Update'
  }
}
