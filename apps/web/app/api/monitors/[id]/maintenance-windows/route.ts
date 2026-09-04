/**
 * apps/web/app/api/monitors/[id]/maintenance-windows/route.ts
 *
 * GET    /api/monitors/:id/maintenance-windows         — list all windows
 * POST   /api/monitors/:id/maintenance-windows         — create a window
 *
 * DELETE /api/monitors/:id/maintenance-windows/:wid    — remove a window
 * PATCH  /api/monitors/:id/maintenance-windows/:wid    — toggle enabled
 *
 * The IANA-zone check is intentionally loose here — a typo should fail
 * loud at the time the row is saved, not at the moment the probe tries
 * to project the local time. The pure time math throws on unknown zones,
 * which surfaces the bug.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getViewer } from '@/lib/authz.ts'
import {
  createMaintenanceWindow,
  listMaintenanceWindows,
} from '@scanlyfix/db'

export const runtime = 'nodejs'

// ─── Shared validation ────────────────────────────────────────────────────────

/** "HH:MM" or "HH:MM:SS". The form sends HH:MM. */
const TimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Time must be HH:MM (24h)')

const CreateSchema = z
  .object({
    /** 0–6 (Sun–Sat), null = daily. The form sends 0..6 as numbers. */
    dayOfWeek: z
      .number()
      .int()
      .min(0, 'dayOfWeek must be 0–6')
      .max(6, 'dayOfWeek must be 0–6')
      .nullable(),
    startTime: TimeSchema,
    /**
     * Bounded: 5 min – 23h 59 min. 24h caps the API contract — a window
     * longer than a day would wrap past midnight, and the time math only
     * covers a single local day.
     */
    durationMin: z
      .number()
      .int()
      .min(5, 'Window must be at least 5 minutes')
      .max(1439, 'Window must be under 24 hours'),
    /** IANA timezone. Validated on the server — not by the regex. */
    timezone: z.string().min(1).max(64),
    /** Optional human-readable reason. Shown on the public status page. */
    reason: z.string().max(200).nullable().optional(),
  })
  .refine(
    // WHY server-side validate: an unknown zone surfaces a bad row at probe
    // time. Failing here turns the bug into a 400 the user can fix.
    (v) => isValidIanaZone(v.timezone),
    { message: 'Unknown IANA timezone', path: ['timezone'] },
  )

function isValidIanaZone(zone: string): boolean {
  try {
    // Throws RangeError on a zone Intl does not recognise.
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date())
    return true
  } catch {
    return false
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const windows = await listMaintenanceWindows(id, viewer)
  return NextResponse.json({ windows })
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

  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  const row = await createMaintenanceWindow(id, viewer, {
    dayOfWeek: parsed.data.dayOfWeek,
    startTime: parsed.data.startTime,
    durationMin: parsed.data.durationMin,
    timezone: parsed.data.timezone,
    reason: parsed.data.reason ?? null,
  })
  if (!row) {
    return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
  }

  return NextResponse.json({ window: row })
}
