/**
 * The two limits that stand between this endpoint and being abused.
 *
 * Backed by counting rows in `scans` rather than by Redis. A scan is seconds
 * of network work, so the request volume here is inherently low, the columns
 * were already being written, and it is one less service to run. The functions
 * below are the contract; if volume ever makes a count query the bottleneck,
 * their bodies change and nothing else does.
 *
 * What that choice means precisely: these count scans that were STARTED, not
 * HTTP requests. A flood of requests that never becomes a scan costs a count
 * query and belongs to the CDN, not to this table. What is being rationed here
 * is the expensive thing — fetching somebody else's server.
 */

import 'server-only'
import { countScansByHostSince, countScansByIpSince, type WindowUsage } from '@darvin/db'

const HOUR_MS = 3_600_000

/** Enough to try a few sites and share a link; not enough to enumerate a list. */
const PER_VISITOR = { limit: 5, windowMs: HOUR_MS }

/**
 * The limit that protects OTHER PEOPLE. Without it, ten visitors on ten
 * addresses can aim this service at one small site, and the abuse report
 * arrives at our host rather than theirs. It counts every visitor's scans of a
 * host together, which is what makes it work when the per-visitor limit is
 * bypassed or simply spread across a botnet.
 */
const PER_TARGET = { limit: 10, windowMs: HOUR_MS }

export type RateVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly retryAfterSeconds: number }

/**
 * Seconds until the window has room again — the moment the oldest scan in it
 * ages out. Falls back to the full window when there is somehow nothing to
 * measure, which over-states the wait rather than inviting an immediate retry.
 */
function retryAfter(usage: WindowUsage, windowMs: number): number {
  const oldest = usage.oldest?.getTime()
  const freeAt = oldest === undefined ? Date.now() + windowMs : oldest + windowMs
  return Math.max(1, Math.ceil((freeAt - Date.now()) / 1000))
}

function humanDelay(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`
  const minutes = Math.ceil(seconds / 60)
  return minutes === 1 ? 'a minute' : `${minutes} minutes`
}

export async function checkScanAllowed(input: {
  anonIpHash: string
  targetHost: string
}): Promise<RateVerdict> {
  const now = Date.now()

  const visitor = await countScansByIpSince(input.anonIpHash, new Date(now - PER_VISITOR.windowMs))
  if (visitor.count >= PER_VISITOR.limit) {
    const seconds = retryAfter(visitor, PER_VISITOR.windowMs)
    return {
      ok: false,
      reason: `You have run ${PER_VISITOR.limit} scans in the last hour. Try again in ${humanDelay(seconds)}.`,
      retryAfterSeconds: seconds,
    }
  }

  const target = await countScansByHostSince(input.targetHost, new Date(now - PER_TARGET.windowMs))
  if (target.count >= PER_TARGET.limit) {
    const seconds = retryAfter(target, PER_TARGET.windowMs)
    return {
      ok: false,
      // Worded so the visitor understands this is not about them: the site has
      // been scanned enough for one hour, by anyone.
      reason:
        `${input.targetHost} has been scanned ${PER_TARGET.limit} times in the last hour. ` +
        `To stay polite to the site, try again in ${humanDelay(seconds)}.`,
      retryAfterSeconds: seconds,
    }
  }

  return { ok: true }
}

/** How stale a cached scan may be before a repeat request re-scans the target. */
export const DEDUP_WINDOW_MS = 10 * 60_000
