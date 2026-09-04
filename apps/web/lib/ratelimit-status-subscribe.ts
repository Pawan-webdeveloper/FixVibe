/**
 * apps/web/lib/ratelimit-status-subscribe.ts
 *
 * Per-IP rate limit for the public /api/status/subscribe endpoint.
 *
 * Backed by the same shape as the scan rate limit (a row count over a
 * time window) rather than a third service. The cost of an extra count
 * query is a couple of milliseconds and keeps this endpoint free of
 * Redis / Upstash on the read path.
 *
 * 5 attempts per IP per hour. The intent is "let a human try a few
 * times without retrying forever, refuse a bot". Not "share this with
 * every other visitor on the same NAT" — the per-IP window is the one
 * the visitor sees; the project-wide limits elsewhere protect the site.
 */

import 'server-only'
import { countSubscribeAttemptsByIpSince } from '@scanlyfix/db'

const HOUR_MS = 3_600_000
const PER_IP = { limit: 5, windowMs: HOUR_MS }

export type SubscribeRateVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly retryAfterSeconds: number }

function retryAfterSeconds(
  oldest: Date | null,
  windowMs: number,
): number {
  const freeAt = oldest ? oldest.getTime() + windowMs : Date.now() + windowMs
  return Math.max(1, Math.ceil((freeAt - Date.now()) / 1000))
}

function humanDelay(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`
  const minutes = Math.ceil(seconds / 60)
  return minutes === 1 ? 'a minute' : `${minutes} minutes`
}

export async function checkSubscribeAllowed(
  ipHash: string,
): Promise<SubscribeRateVerdict> {
  const since = new Date(Date.now() - PER_IP.windowMs)
  const usage = await countSubscribeAttemptsByIpSince(ipHash, since)

  if (usage.count >= PER_IP.limit) {
    const seconds = retryAfterSeconds(usage.oldest, PER_IP.windowMs)
    return {
      ok: false,
      reason:
        `Too many subscribe attempts from this address (${PER_IP.limit}/hour). ` +
        `Try again in ${humanDelay(seconds)}.`,
      retryAfterSeconds: seconds,
    }
  }

  return { ok: true }
}
