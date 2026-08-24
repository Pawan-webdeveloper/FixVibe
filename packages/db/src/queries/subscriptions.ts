/**
 * The Stripe mirror.
 *
 * These are the only writes driven by an external system, which makes
 * idempotency the whole design constraint: Stripe retries a webhook until it is
 * acknowledged, and it may deliver the same event twice even after a success.
 * Every function here is safe to run again with the same payload.
 *
 * `plan` and `status` stay free text on purpose — see the schema comment.
 * Stripe's status vocabulary grows and tier names get rebranded, and an enum
 * there means an ALTER TYPE every time pricing changes.
 */

import { eq } from 'drizzle-orm'
import { db } from '../client.ts'
import { subscriptions, type Subscription } from '../schema.ts'

export interface SubscriptionState {
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
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
 * Stripe account, and inventing a row for them would be worse than dropping it.
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
 * Webhooks after the first arrive keyed by Stripe's customer id, not ours —
 * the event has no idea what our user table looks like.
 */
export async function findUserByStripeCustomer(stripeCustomerId: string): Promise<string | null> {
  const row = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeCustomerId, stripeCustomerId),
    columns: { userId: true },
  })
  return row?.userId ?? null
}
