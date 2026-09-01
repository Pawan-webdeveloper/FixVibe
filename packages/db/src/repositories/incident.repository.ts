//  Single source of truth for all incident-related DB queries.
//  * Keeps raw Drizzle calls out of business logic and services.

import { and, desc, eq, isNull } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import type * as schema from '../schema.ts'
import { incidents } from '../schema.ts'
import type { Incident, NewIncident } from '../schema.ts'

export type DB = PostgresJsDatabase<typeof schema>


/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */


export interface OpenIncident extends Incident {
  resolvedAt: null
  durationMs: null
}

export interface ResolvedIncident extends Incident {
  resolvedAt: Date
  durationMs: number
}




/* ------------------------------------------------------------------ */
/* Queries                                                              */
/* ------------------------------------------------------------------ */
 
/**
 * Returns the single open (unresolved) incident for a monitor, or null.
 * Uses the `incidents_unresolved_idx` index for O(log n) lookup.
 */


export async function findOpenIncident(
  db: DB,
  monitorId: string,
): Promise<OpenIncident | null> {
  const [row] = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.monitorId, monitorId), isNull(incidents.resolvedAt)))
    .limit(1)
 
  return (row as OpenIncident | undefined) ?? null
}
 

/**
 * Returns the N most recent incidents for a monitor (open + resolved).
 * Uses the `incidents_monitor_started_idx` index.
 */

export async function listIncidentsByMonitor(
  db: DB,
  monitorId: string,
  limit = 50,
): Promise<Incident[]> {
  return db
    .select()
    .from(incidents)
    .where(eq(incidents.monitorId, monitorId))
    .orderBy(desc(incidents.startedAt))
    .limit(limit)
}



/**
 * Creates a new incident record (called when a monitor first goes down).
 */
export async function createIncident(
  db: DB,
  data: NewIncident,
): Promise<Incident> {
  const [row] = await db.insert(incidents).values(data).returning()
  if (!row) throw new Error('Failed to create incident')
  return row
}




/**
 * Resolves an open incident by setting resolvedAt + durationMs.
 * Returns the updated row, or null if the incident was not found.
 */

export async function resolveIncident(
  db: DB,
  incidentId: string,
  resolvedAt: Date,
): Promise<ResolvedIncident | null> {
  const [existing] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1)
 
  if (!existing || !existing.startedAt) return null
 
  const durationMs = resolvedAt.getTime() - new Date(existing.startedAt).getTime()
 
  const [row] = await db
    .update(incidents)
    .set({ resolvedAt, durationMs })
    .where(eq(incidents.id, incidentId))
    .returning()
 
  return (row as ResolvedIncident | undefined) ?? null
}



/**
 * Returns all currently open incidents across all monitors.
 * Useful for a global "active incidents" dashboard panel.
 */

export async function listAllOpenIncidents(db: DB): Promise<OpenIncident[]> {
  const rows = await db
    .select()
    .from(incidents)
    .where(isNull(incidents.resolvedAt))
    .orderBy(desc(incidents.startedAt))
 
  return rows as OpenIncident[]
}