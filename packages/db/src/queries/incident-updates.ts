/**
 * Incident updates — the human messages shown on the public status page
 * timeline and posted by the on-call from the internal incident view.
 *
 * Layering:
 *   - Pure validation (IncidentUpdateStatusSchema, IncidentUpdateMessageSchema)
 *     lives here so both the API route and tests import one source.
 *   - listIncidentUpdatesByIncident: DB-only, no Viewer. Callers decide
 *     public-vs-internal by passing the right shape filter — that keeps
 *     the auth gate at the caller, where the project ownership check
 *     already happens for the parent incident.
 *   - listIncidentUpdatesPublic / listIncidentUpdatesInternal: thin
 *     wrappers that pick the right shape and enforce the Viewer where
 *     needed.
 *   - postIncidentUpdate: auth-gated writer. The Viewer must own the
 *     incident's project (same rule as ack/notes).
 */

import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../client.ts'
import {
  incidentUpdates,
  incidents,
  monitors,
  projects,
  users,
  type IncidentUpdate,
} from '../schema.ts'
import { getProject } from './projects.ts'
import type { Viewer } from './viewer.ts'

/* -------------------------------------------------------------------------- */
/* Status vocabulary                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The four stages shown on a Statuspage-style timeline. Free text in the
 * DB (so adding "postmortem" doesn't ALTER TYPE), but locked to this set
 * at every app-layer boundary — the API route, the postIncidentUpdate
 * helper, the UI badges.
 *
 * Order matters: this is also the lifecycle order. The status page
 * timeline reads newest-first; the badge colour follows the stage.
 */
export const INCIDENT_UPDATE_STATUSES = [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
] as const

export type IncidentUpdateStatus = (typeof INCIDENT_UPDATE_STATUSES)[number]

/** Reject anything outside the four-stage vocabulary at the API edge. */
export const IncidentUpdateStatusSchema = z.enum(INCIDENT_UPDATE_STATUSES)

/**
 * Message length bounds.
 *
 * - Min 1: an empty post is almost always a misclick; refuse rather than
 *   silently render a blank timeline row.
 * - Max 4000: same as incident notes — a single post cannot bloat the row,
 *   and 4KB is enough for a multi-paragraph postmortem. Longer write-ups
 *   belong in a separate doc linked from the timeline.
 */
export const INCIDENT_UPDATE_MESSAGE_MIN = 1
export const INCIDENT_UPDATE_MESSAGE_MAX = 4000

export const IncidentUpdateMessageSchema = z
  .string()
  .trim()
  .min(INCIDENT_UPDATE_MESSAGE_MIN, 'Message cannot be empty')
  .max(INCIDENT_UPDATE_MESSAGE_MAX, `Message must be ${INCIDENT_UPDATE_MESSAGE_MAX} characters or less`)

/** Shape used by the POST /api/incidents/[id]/updates body. */
export const PostIncidentUpdateSchema = z.object({
  status: IncidentUpdateStatusSchema,
  message: IncidentUpdateMessageSchema,
})
export type PostIncidentUpdateInput = z.infer<typeof PostIncidentUpdateSchema>

/* -------------------------------------------------------------------------- */
/* Public-safe shape                                                           */
/* -------------------------------------------------------------------------- */

/**
 * What the public status page renders. Deliberately omits `createdBy`
 * (an internal UUID) — the public timeline shows the message and the
 * stage, not who in the team posted it.
 */
export interface PublicIncidentUpdate {
  status: IncidentUpdateStatus
  message: string
  createdAt: Date
}

/* -------------------------------------------------------------------------- */
/* Internal shape                                                              */
/* -------------------------------------------------------------------------- */

/** Row + creator's email for the internal incident view. */
export interface IncidentUpdateWithCreator extends IncidentUpdate {
  creatorEmail: string | null
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Internal list — auth-gated, returns the row plus creator email.
 *
 * The caller (incident detail page) already has the Viewer's project
 * ownership check from when it loaded the parent incident; this function
 * re-checks via the project join so the rule "viewer must own the
 * incident's project" lives in ONE place (here), not at every caller.
 */
export async function listIncidentUpdatesInternal(
  incidentId: string,
  viewer: Viewer,
): Promise<IncidentUpdateWithCreator[]> {
  const projectId = await projectIdForIncident(incidentId, viewer)
  if (!projectId) return []

  return db
    .select({
      id: incidentUpdates.id,
      incidentId: incidentUpdates.incidentId,
      status: incidentUpdates.status,
      message: incidentUpdates.message,
      createdBy: incidentUpdates.createdBy,
      createdAt: incidentUpdates.createdAt,
      creatorEmail: users.email,
    })
    .from(incidentUpdates)
    .leftJoin(users, eq(users.id, incidentUpdates.createdBy))
    .where(eq(incidentUpdates.incidentId, incidentId))
    .orderBy(asc(incidentUpdates.createdAt))
}

/**
 * Public list — system call (no Viewer), returns only the safe shape.
 *
 * Used by `getPublicStatus` for the /status/[slug] timeline. The
 * caller has already verified the project is reachable by slug; we
 * rely on `incidentId IN (visibleIncidentsForProject)` to scope to
 * the right project when a future query layer needs it. Today the
 * single-incident path is fine because the public route already
 * filters by project at the components level.
 */
export async function listIncidentUpdatesPublic(
  incidentId: string,
): Promise<PublicIncidentUpdate[]> {
  const rows = await db
    .select({
      status: incidentUpdates.status,
      message: incidentUpdates.message,
      createdAt: incidentUpdates.createdAt,
    })
    .from(incidentUpdates)
    .where(eq(incidentUpdates.incidentId, incidentId))
    .orderBy(asc(incidentUpdates.createdAt))

  return rows.map((r) => ({
    status: parseStatus(r.status),
    message: r.message,
    createdAt: r.createdAt,
  }))
}

/**
 * Batch read — public-safe — for many incidents at once.
 *
 * `getPublicStatus` calls this once with every incident id surfaced on
 * the status page; we run a single SELECT and the caller groups by
 * incidentId. One round trip beats N, and the timeline render is the
 * hot path during an incident.
 */
export async function listIncidentUpdatesPublicForIncidents(
  incidentIds: ReadonlyArray<string>,
): Promise<Map<string, PublicIncidentUpdate[]>> {
  const result = new Map<string, PublicIncidentUpdate[]>()
  if (incidentIds.length === 0) return result

  const rows = await db
    .select({
      incidentId: incidentUpdates.incidentId,
      status: incidentUpdates.status,
      message: incidentUpdates.message,
      createdAt: incidentUpdates.createdAt,
    })
    .from(incidentUpdates)
    .where(inArray(incidentUpdates.incidentId, [...incidentIds]))
    .orderBy(asc(incidentUpdates.createdAt))

  for (const row of rows) {
    const list = result.get(row.incidentId) ?? []
    list.push({
      status: parseStatus(row.status),
      message: row.message,
      createdAt: row.createdAt,
    })
    result.set(row.incidentId, list)
  }
  return result
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Auth-gated writer. Returns the new row (with creator email) on success,
 * null on auth/lookup failure.
 *
 * Same auth rule as `acknowledgeIncident` / `setIncidentNotes`: the
 * Viewer must own the project the incident belongs to. The rule is
 * encoded in one place (`projectIdForIncident`) so a future policy
 * change (org-level write access) updates every incident-mutation
 * path together.
 */
export async function postIncidentUpdate(
  incidentId: string,
  viewer: Viewer,
  input: PostIncidentUpdateInput,
): Promise<IncidentUpdateWithCreator | null> {
  if (viewer.kind !== 'user') return null

  const projectId = await projectIdForIncident(incidentId, viewer)
  if (!projectId) return null

  const [row] = await db
    .insert(incidentUpdates)
    .values({
      incidentId,
      status: input.status,
      message: input.message,
      createdBy: viewer.userId,
    })
    .returning()

  if (!row) return null

  // Re-read to attach creator email in one query.
  // (The insert just wrote it; this is the cheapest way to keep the
  // return shape symmetric with listIncidentUpdatesInternal.)
  const [withEmail] = await db
    .select({
      id: incidentUpdates.id,
      incidentId: incidentUpdates.incidentId,
      status: incidentUpdates.status,
      message: incidentUpdates.message,
      createdBy: incidentUpdates.createdBy,
      createdAt: incidentUpdates.createdAt,
      creatorEmail: users.email,
    })
    .from(incidentUpdates)
    .leftJoin(users, eq(users.id, incidentUpdates.createdBy))
    .where(eq(incidentUpdates.id, row.id))
    .limit(1)

  return withEmail ?? null
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Resolve an incident id to its project id, gated by the Viewer's project
 * ownership. Returns null if the incident doesn't exist OR the viewer
 * doesn't own its project — the two are deliberately indistinguishable
 * to the caller, matching the 404-equals "wrong id / not yours" rule
 * used by acknowledgeIncident / setIncidentNotes.
 */
async function projectIdForIncident(
  incidentId: string,
  viewer: Viewer,
): Promise<string | null> {
  // incidents → monitors → projects: a single SELECT picks up projectId.
  const lookup = await db
    .select({ projectId: monitors.projectId })
    .from(incidents)
    .innerJoin(monitors, eq(monitors.id, incidents.monitorId))
    .where(eq(incidents.id, incidentId))
    .limit(1)

  const found = lookup[0]
  if (!found) return null

  // For 'user' viewers, go through getProject so the same ownership rule
  // applies everywhere. For anonymous, deny — the API route also refuses
  // anonymous before reaching this helper.
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, found.projectId)),
    columns: { id: true },
  })
  if (!project) return null

  // Re-use getProject's auth check — it returns null for non-owners,
  // which is exactly the contract we want here.
  const owned = await getProject(found.projectId, viewer)
  return owned ? found.projectId : null
}

/**
 * Coerce a stored status string into the typed union.
 *
 * Today the column is `text` and only the four known values are written,
 * but a future migration could leave a stale value behind, and a typo
 * in a manual INSERT should not crash the public page. Falls back to
 * 'investigating' (the first stage) so the badge still renders and the
 * timeline still reads correctly.
 */
export function parseStatus(raw: string): IncidentUpdateStatus {
  return (INCIDENT_UPDATE_STATUSES as ReadonlyArray<string>).includes(raw)
    ? (raw as IncidentUpdateStatus)
    : 'investigating'
}

/**
 * Display label for a status. Pure — exported for the UI to reuse.
 */
export function incidentUpdateStatusLabel(status: IncidentUpdateStatus): string {
  switch (status) {
    case 'investigating':
      return 'Investigating'
    case 'identified':
      return 'Identified'
    case 'monitoring':
      return 'Monitoring'
    case 'resolved':
      return 'Resolved'
  }
}
