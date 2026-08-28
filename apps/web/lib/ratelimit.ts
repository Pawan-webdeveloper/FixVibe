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
import {
  countScansByHostSince,
  countScansByIpSince,
  countScansForUserSince,
  type WindowUsage,
} from '@scanlyfix/db'

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
const PER_TARGET = { limit: 20, windowMs: HOUR_MS }

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

/**
 * The API's burst ceiling, keyed on the ACCOUNT rather than on the address.
 *
 * Higher than a browser visitor's five, and the number is not the point — the
 * KEY is. A CI fleet shares one egress address and rotates it, so an IP-keyed
 * limit either throttles the whole fleet as if it were one person or lets a
 * single caller escape by moving. An account cannot move, and an account is
 * also what the monthly allowance and the bill are attached to.
 */
const PER_ACCOUNT_HOURLY = { limit: 60, windowMs: HOUR_MS }

/**
 * The API's rate limit.
 *
 * Two of the three limits in this file apply; the per-visitor IP one does not,
 * for the reason above. The per-TARGET limit very much does: it is the one
 * that protects somebody else's server, and an authenticated caller is no more
 * entitled to hammer a third party than an anonymous one is. That is why it is
 * re-checked here rather than being something the API opts out of.
 */
export async function checkApiScanAllowed(input: {
  userId: string
  targetHost: string
}): Promise<RateVerdict> {
  const now = Date.now()

  const used = await countScansForUserSince(input.userId, new Date(now - PER_ACCOUNT_HOURLY.windowMs))
  if (used >= PER_ACCOUNT_HOURLY.limit) {
    // No `oldest` to measure against — countScansForUserSince returns a count
    // and nothing else — so the wait is the full window. That over-states it,
    // which is the safe direction: a caller told to wait too long retries
    // late, and a caller told to retry immediately writes a hot loop.
    const seconds = Math.ceil(PER_ACCOUNT_HOURLY.windowMs / 1000)
    return {
      ok: false,
      reason: `This account has started ${PER_ACCOUNT_HOURLY.limit} scans in the last hour. Try again in ${humanDelay(seconds)}.`,
      retryAfterSeconds: seconds,
    }
  }

  const target = await countScansByHostSince(input.targetHost, new Date(now - PER_TARGET.windowMs))
  if (target.count >= PER_TARGET.limit) {
    const seconds = retryAfter(target, PER_TARGET.windowMs)
    return {
      ok: false,
      reason:
        `${input.targetHost} has been scanned ${PER_TARGET.limit} times in the last hour, by everyone together. ` +
        `To stay polite to the site, try again in ${humanDelay(seconds)}.`,
      retryAfterSeconds: seconds,
    }
  }

  return { ok: true }
}

/** How stale a cached scan may be before a repeat request re-scans the target. */
export const DEDUP_WINDOW_MS = 10 * 60_000
