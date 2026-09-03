/**
 * FILE: apps/web/app/api/monitors/[id]/snooze/route.ts
 *
 * POST   /api/monitors/:id/snooze  — snooze a monitor
 * DELETE /api/monitors/:id/snooze  — unsnooze immediately
 * GET    /api/monitors/:id/snooze  — get active snooze status
 */

import { NextResponse } from 'next/server'
import { getViewer } from '@/lib/authz.ts'
import { snoozeMonitor, unsnoozeMonitor, getActiveSnooze } from '@scanlyfix/db'
import { z } from 'zod'

export const runtime = 'nodejs'

/* ------------------------------------------------------------------ */
/* Validation                                                           */
/* ------------------------------------------------------------------ */

const SnoozeSchema = z.object({
  /** ISO-8601 string or null for indefinite snooze. */
  expiresAt: z
    .string()
    .datetime({ message: 'expiresAt must be a valid ISO-8601 datetime' })
    .nullable()
    .optional(),
  reason: z
    .string()
    .max(200, 'Reason must be 200 characters or less')
    .nullable()
    .optional(),
})

/* ------------------------------------------------------------------ */
/* Handlers                                                             */
/* ------------------------------------------------------------------ */

interface RouteContext {
  params: Promise<{ id: string }>
}

/** GET — returns active snooze or null */
export async function GET(_request: Request, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const snooze = await getActiveSnooze(id, viewer)
  return NextResponse.json({ snooze })
}

/**
 * POST — snooze the monitor.
 *
 * Body: { expiresAt?: string | null, reason?: string | null }
 *
 * expiresAt = null or omitted → snoozed indefinitely.
 * expiresAt must be in the future — we reject past timestamps.
 */
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

  const parsed = SnoozeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  const expiresAt = parsed.data.expiresAt
    ? new Date(parsed.data.expiresAt)
    : null

  // Reject past timestamps — snoozed until yesterday is not a snooze
  if (expiresAt && expiresAt <= new Date()) {
    return NextResponse.json(
      { error: 'expiresAt must be in the future' },
      { status: 400 },
    )
  }

  const snooze = await snoozeMonitor(id, viewer, {
    expiresAt,
    reason: parsed.data.reason ?? null,
  })

  if (!snooze) {
    return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
  }

  return NextResponse.json({ snooze })
}

/** DELETE — unsnooze immediately */
export async function DELETE(_request: Request, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  await unsnoozeMonitor(id, viewer)
  return NextResponse.json({ ok: true })
}