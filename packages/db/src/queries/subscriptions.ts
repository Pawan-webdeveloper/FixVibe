/**
 * The payment processor's view of the truth, mirrored into ours.
 *
 * These are the only writes driven by an external system, which makes
 * idempotency the whole design constraint: Razorpay retries a webhook until it
 * is acknowledged, and it can deliver the same event twice even after a
 * success. It also does NOT guarantee ordering — `subscription.charged` for a
 * renewal can arrive before the `subscription.activated` that preceded it — so
 * every function here is safe to run again, in any order, with the same
 * payload.
 *
 * `plan` and `status` stay free text on purpose — see the schema comment. A
 * processor's status vocabulary grows and tier names get rebranded, and an enum
 * there means an ALTER TYPE every time pricing changes.
 */

import { eq } from 'drizzle-orm'
import { db } from '../client.ts'
import { subscriptions, type Subscription } from '../schema.ts'

export interface SubscriptionState {
  billingCustomerId?: string | null
  billingSubscriptionId?: string | null
  plan?: string
  status?: string
  periodEnd?: Date | null
}

export async function getSubscription(userId: string): Promise<Subscription | null> {
  const row = await db.query.subscriptions.findFirst({ where: eq(subscriptions.userId, userId) })
  return row ?? null
}

/**
 * ensureUser creates the row at signup, so this updates rather than upserts —
 * a webhook for a user who does not exist is a webhook for someone else's
 * account, and inventing a row for them would be worse than dropping it.
 */
export async function updateSubscription(userId: string, state: SubscriptionState): Promise<boolean> {
  const updated = await db
    .update(subscriptions)
    .set({ ...state, updatedAt: new Date() })
    .where(eq(subscriptions.userId, userId))
    .returning({ userId: subscriptions.userId })

  return updated.length > 0
}

/**
 * Map a webhook back to an account by the processor's subscription id.
 *
 * Razorpay subscription events carry our `notes`, so that is the primary
 * mapping and this is the fallback — for a subscription created or edited in
 * the Razorpay dashboard, which arrives with no notes of ours at all.
 */
export async function findUserByBillingSubscription(billingSubscriptionId: string): Promise<string | null> {
  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.billingSubscriptionId, billingSubscriptionId),
    columns: { userId: true },
  })
  return row?.userId ?? null
}
