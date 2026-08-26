/**
 * The queue client.
 *
 * Arrives in Phase 5 rather than earlier because until now nothing needed it:
 * an inline scan finishes in about two seconds, and a queue would have been a
 * second failure domain bought for nothing. Cron is different — a job that must
 * run at 03:00 whether or not anyone is visiting cannot live in a request.
 */

import 'server-only'
import { Inngest } from 'inngest'

/**
 * Dev mode is inferred rather than left to an env var.
 *
 * Inngest assumes cloud by default and then refuses to serve without a signing
 * key — a fresh clone gets a 500 from /api/inngest and a message about a
 * variable nobody has yet. Deciding it from NODE_ENV means `pnpm dev` works out
 * of the box, and production still requires the key because isDev is false
 * there regardless of what is or is not configured.
 */
const isDev = process.env.NODE_ENV !== 'production' && !process.env.INNGEST_SIGNING_KEY

export const inngest = new Inngest({ id: 'darvin', isDev })

/**
 * Event names, in one place. A typo in an event string is a job that silently
 * never runs — no error, no handler, nothing in a log to notice.
 */
export const EVENTS = {
  /** One per due monitor, emitted by the sweep. */
  monitorDue: 'darvin/monitor.due',
} as const
