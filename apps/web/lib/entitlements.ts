/**
 * What this viewer is allowed to see, resolved once per request.
 *
 * Separate from plans.ts because that file is a table and this is a lookup:
 * every caller asks the same question — "what can the person in front of me
 * do" — and gets the same answer shape whether they are signed out, on the free
 * tier, or paying.
 *
 * Anonymous resolves to free rather than to nothing. The landing-page scan is
 * the product's front door and it must produce a real report; treating a
 * logged-out reader as having no entitlements at all would show them an empty
 * page and no reason to sign up.
 */

import 'server-only'
import { getUserContext, type Viewer } from '@darvin/db'
import { planFor, type Plan } from './plans.ts'

export interface Entitlements {
  plan: Plan
  /** True only for a signed-in account; the paywall copy differs for the two. */
  signedIn: boolean
}

export async function entitlementsFor(viewer: Viewer): Promise<Entitlements> {
  if (viewer.kind !== 'user') return { plan: planFor('free'), signedIn: false }

  const context = await getUserContext(viewer.userId)
  return { plan: planFor(context?.plan), signedIn: true }
}
