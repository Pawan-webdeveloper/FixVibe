/**
 * apps/web/app/api/incidents/[id]/notes/route.ts
 *
 * PATCH /api/incidents/:id/notes
 *
 * Update an incident's on-call notes. Replaces the text wholesale — the
 * audit trail is "this snapshot, this person, this timestamp" via the
 * acknowledgedBy column. The body carries the new text; the server stores
 * it as-is, trimming the empty case to null.
 *
 * Body: { notes: string | null }
 *
 * Returns:
 *   200 { incident }                 — full updated row
 *   400 { error }                    — notes too long (>4000) or wrong shape
 *   401 { error: 'Unauthorized' }    — anonymous viewer
 *   404 { error: 'Incident not found' } — wrong id, or no ownership
 *
 * 4000 chars is a hard limit: a single incident cannot bloat the row, and
 * 4KB is enough for a multi-paragraph post-mortem summary. Longer notes
 * belong in a separate doc the team links from this row.
 */

import { NextResponse } from 'next/server'
import { setIncidentNotes } from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'
import { z } from 'zod'

export const runtime = 'nodejs'

const NotesSchema = z.object({
  notes: z
    .string()
    .max(4000, 'Notes must be 4000 characters or less')
    .nullable()
    .optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteContext) {
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

  const parsed = NotesSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  const incident = await setIncidentNotes(id, viewer, parsed.data.notes ?? null)
  if (!incident) {
    return NextResponse.json({ error: 'Incident not found' }, { status: 404 })
  }

  return NextResponse.json({ incident })
}
