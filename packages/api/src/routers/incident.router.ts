/*
 * tRPC router exposing incident queries to the frontend.
 * Mount this at: appRouter -> incidents
 *
 * If you're using a plain Express / Hono REST API instead of tRPC,
 * see the REST equivalent comments at the bottom of this file.
 */

/* monitor error — fixed imports: createTRPCRouter now resolves from ./trpc.ts,
 * removed unused publicProcedure import, protectedProcedure is properly imported */

import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import {
  findOpenIncident,
  listAllOpenIncidents,
  listIncidentsByMonitor,
} from '../../../db/src/repositories/incident.repository.ts'
import { createTRPCRouter, protectedProcedure } from '../trpc.ts'


export const incidentRouter = createTRPCRouter({
  /**
   * GET /incidents?monitorId=&limit=
   * List incidents for a specific monitor (newest first).
   */
  list: protectedProcedure
    .input(
      z.object({
        monitorId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Optional: verify the monitor belongs to ctx.user via your monitors repo
      return listIncidentsByMonitor(ctx.db, input.monitorId, input.limit)
    }),

  /**
   * GET /incidents/open?monitorId=
   * Returns the single open incident for a monitor, or null.
   */
  getOpen: protectedProcedure
    .input(z.object({ monitorId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return findOpenIncident(ctx.db, input.monitorId)
    }),

  /**
   * GET /incidents/all-open
   * Returns every open incident across all monitors.
   * Useful for a global status dashboard.
   */
  allOpen: protectedProcedure.query(async ({ ctx }) => {
    return listAllOpenIncidents(ctx.db)
  }),
})
 




/*
 * ─── REST EQUIVALENT (Express / Hono) ──────────────────────────────────────
 *
 * GET /api/monitors/:monitorId/incidents
 *   → listIncidentsByMonitor(db, monitorId, limit)
 *
 * GET /api/monitors/:monitorId/incidents/open
 *   → findOpenIncident(db, monitorId)
 *
 * GET /api/incidents/open
 *   → listAllOpenIncidents(db)
 * ───────────────────────────────────────────────────────────────────────────
 */