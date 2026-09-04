/**
 * apps/web/app/api/monitors/[id]/maintenance-windows/[wid]/route.ts
 *
 * DELETE /api/monitors/:id/maintenance-windows/:wid  — remove a window
 * PATCH  /api/monitors/:id/maintenance-windows/:wid  — toggle enabled
 *
 * The :wid is the row's uuid, NOT the monitor's. The :id is the monitor
 * for the URL contract (so a "wrong project" 404 is consistent with the
 * other monitor routes) but the actual auth and lookup use :wid.
 *
 * PATCH body: { enabled: boolean }
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getViewer } from '@/lib/authz.ts'
import {
  deleteMaintenanceWindow,
  setMaintenanceWindowEnabled,
} from '@scanlyfix/db'

export const runtime = 'nodejs'

const PatchSchema = z.object({
  enabled: z.boolean(),
})

interface RouteContext {
  params: Promise<{ id: string; wid: string }>
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { wid } = await params
  const ok = await deleteMaintenanceWindow(wid, viewer)
  if (!ok) {
    return NextResponse.json({ error: 'Window not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { wid } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  const row = await setMaintenanceWindowEnabled(
    wid,
    parsed.data.enabled,
    viewer,
  )
  if (!row) {
    return NextResponse.json({ error: 'Window not found' }, { status: 404 })
  }
  return NextResponse.json({ window: row })
}
