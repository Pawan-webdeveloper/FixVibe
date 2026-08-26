/**
 * The plan allowance, enforced.
 *
 * Distinct from lib/ratelimit.ts, and the two answer different questions.
 * That file protects OTHER PEOPLE — a per-visitor and per-target hourly cap so
 * this service cannot be aimed at somebody's small site. This one protects the
 * BUSINESS: a plan that advertises thirty scans a month and never counts them
 * is a price list, not a limit.
 *
 * Anonymous readers have no allowance to spend and are not checked here at all.
 * They are governed entirely by the rate limiter, which is the correct tool:
 * you cannot meter a month for somebody with no account.
 *
 * A cache hit is never counted. The scan route answers a repeat request from a
 * recent result without touching the target, and charging an allowance for
 * work that did not happen would be charging for nothing.
 */

import 'server-only'
import { countScansForUserSince, type Viewer } from '@darvin/db'
import { periodStart, resetsOn } from './billing-period.ts'
import { entitlementsFor } from './entitlements.ts'

export type QuotaVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

export async function checkScanQuota(viewer: Viewer, now: Date = new Date()): Promise<QuotaVerdict> {
  if (viewer.kind !== 'user') return { ok: true }

  const { plan } = await entitlementsFor(viewer)
  const used = await countScansForUserSince(viewer.userId, periodStart(now))
  if (used < plan.scansPerMonth) return { ok: true }

  return {
    ok: false,
    reason:
      `You have used all ${plan.scansPerMonth} scans on the ${plan.name} plan this month. ` +
      `The allowance resets on ${resetsOn(now)}.`,
  }
}
