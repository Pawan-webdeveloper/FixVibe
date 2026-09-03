/**
 * apps/web/app/api/monitors/[id]/config/route.ts
 *
 * PATCH /api/monitors/:id/config
 * Body: { alertConfig: { failStatusCodes?: number[], maxLatencyMs?: number | null } }
 *
 * Security:
 *  - Auth: viewer must own the monitor's project
 *  - monitorId: UUID validated
 *  - alertConfig: Zod validated before DB write
 *  - Only PATCH allowed — no accidental GET of sensitive config
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, monitors, projects } from '@scanlyfix/db'
import { eq } from 'drizzle-orm'
import { getViewer } from '@/lib/authz.ts'
import { parseAlertConfig } from '@/lib/alert-threshold.ts'

// ─── Input Schema ──────────────────────────────────────────────────────────────
const PatchBodySchema = z.object({
  alertConfig: z.unknown(), // WHY unknown: parseAlertConfig handles validation
})

const UuidSchema = z.string().uuid()

// ─── PATCH Handler ─────────────────────────────────────────────────────────────
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const viewer = await getViewer()

  // ── 2. Validate monitorId ──────────────────────────────────────────────────
  const { id } = await params
  if (!UuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid monitor ID' }, { status: 400 })
  }

  // ── 3. Parse body ──────────────────────────────────────────────────────────
  const rawBody = await req.json().catch(() => null)
  const bodyParsed = PatchBodySchema.safeParse(rawBody)
  if (!bodyParsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 },
    )
  }

  // ── 4. Validate alertConfig ────────────────────────────────────────────────
  const configResult = parseAlertConfig(bodyParsed.data.alertConfig)
  if (!configResult.ok) {
    return NextResponse.json(
      { error: configResult.reason },
      { status: 400 },
    )
  }

  // ── 5. Ownership check ─────────────────────────────────────────────────────
  // WHY fetch monitor + project: ensure viewer owns this monitor
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  try {
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
      columns: { id: true, projectId: true },
    })

    if (!monitor) {
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
    }

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, monitor.projectId),
      columns: { id: true, ownerId: true },
    })

    if (!project || project.ownerId !== viewer.userId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // ── 6. Update ────────────────────────────────────────────────────────────
    await db
      .update(monitors)
      .set({ alertConfig: configResult.config })
      .where(eq(monitors.id, id))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[monitor-config] PATCH failed:', err)
    return NextResponse.json(
      { error: 'Failed to update config' },
      { status: 500 },
    )
  }
}

// ─── GET Handler ───────────────────────────────────────────────────────────────
// WHY include GET: UI needs to show current config on load
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewer()

  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const { id } = await params
  if (!UuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid monitor ID' }, { status: 400 })
  }

  try {
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
      columns: { id: true, projectId: true, alertConfig: true },
    })

    if (!monitor) {
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
    }

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, monitor.projectId),
      columns: { ownerId: true },
    })

    if (!project || project.ownerId !== viewer.userId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // WHY validate on read: DB could have old/malformed data
    const configResult = parseAlertConfig(monitor.alertConfig ?? {})
    return NextResponse.json({
      alertConfig: configResult.ok ? configResult.config : null,
    })
  } catch (err) {
    console.error('[monitor-config] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to fetch config' },
      { status: 500 },
    )
  }
}