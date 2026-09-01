/**
 * monitor error — This file did not exist. The incident.router.ts imported
 * createTRPCRouter and publicProcedure from it, but the file was missing,
 * causing build failures. Created with the standard tRPC initialization pattern.
 */

import { initTRPC, TRPCError } from '@trpc/server'
import type { DB } from '../../db/src/repositories/incident.repository.ts'

export interface Context {
  db: DB
  userId?: string
}

const t = initTRPC.context<Context>().create()

/**
 * monitor error — exported as createTRPCRouter (aliased from t.router)
 * so the incident.router.ts import resolves correctly.
 */
export const createTRPCRouter = t.router

/**
 * monitor error — publicProcedure requires no authentication.
 * Used for endpoints that anyone can access.
 */
export const publicProcedure = t.procedure

/**
 * monitor error — protectedProcedure requires a valid userId in context.
 * Throws UNAUTHORIZED if the user is not logged in.
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' })
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } })
})
