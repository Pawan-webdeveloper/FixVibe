/**
 * What this viewer is allowed to see, resolved once per request.
 *
 * Separate from plans.ts because that file is a table and this is a lookup:
 * every caller asks the same question — "what can the person in front of me
 * do" — and gets the same answer shape whether they are signed out, on the free
 * tier, or paying.
 *
 * There are three tiers, not two, and the first one is the reason this file
 * exists rather than callers reading plans.ts directly:
 *
 *   signed out  — the scan runs, the score is public and shareable, and every
 *                 finding's title and severity is listed. No finding is opened.
 *   free        — the worst few in full.
 *   pro         — everything, plus the aggregate fix prompt.
 *
 * `findingsInFull` is what redactFindings enforces, and it is a property of the
 * VIEWER rather than of the plan for that reason: a signed-out reader has no
 * plan, and resolving them to "free" — as this used to — would hand out the
 * free tier's three open findings to someone with no account at all.
 *
 * Nothing here reads Supabase. It takes a Viewer, which lib/authz.ts produces,
 * and that is the single seam an auth provider swap has to touch.
 */

import 'server-only'
import type { Category } from '@darvin/checks'
import { getUserContext, type Viewer } from '@darvin/db'
import { planFor, type Plan } from './plans.ts'

export interface Entitlements {
  plan: Plan
  /** True only for a signed-in account; the gate copy differs for the two. */
  signedIn: boolean
  /**
   * How many findings come back with their description, evidence, remediation
   * and fix prompt attached. Zero for a signed-out reader.
   */
  findingsInFull: number
  /** Pillars this account asked us to lead with; null when never asked. */
  priorities: Category[] | null
}

/** What a stranger gets: the whole shape of the report, none of its contents. */
export const ANONYMOUS_ENTITLEMENTS: Entitlements = {
  plan: planFor('free'),
  signedIn: false,
  findingsInFull: 0,
  priorities: null,
}

export async function entitlementsFor(viewer: Viewer): Promise<Entitlements> {
  if (viewer.kind !== 'user') return ANONYMOUS_ENTITLEMENTS

  const context = await getUserContext(viewer.userId)
  const plan = planFor(context?.plan)

  return {
    plan,
    signedIn: true,
    findingsInFull: plan.fullFindings ? Number.POSITIVE_INFINITY : plan.findingsShownInFull,
    priorities: context?.priorities ?? null,
  }
}
