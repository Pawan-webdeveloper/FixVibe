/**
 * Stripe's view of the truth, written into ours.
 *
 * Three things this route gets right on purpose, because each is a well-known
 * way to get it wrong:
 *
 *   The signature is verified against the RAW body, read before anything parses
 *   it. Framework JSON parsing re-serializes, which changes the bytes and makes
 *   every signature fail — the single commonest reason a webhook "just doesn't
 *   work".
 *
 *   Handlers are idempotent. Stripe retries until acknowledged and can deliver
 *   the same event twice after a success, so every write here is a set-to-state
 *   rather than an increment or an insert.
 *
 *   A 200 is returned for events we do not handle, and for events we cannot
 *   attribute. A non-2xx makes Stripe retry forever, so answering "not for us"
 *   with an error turns one stray event into a permanent retry loop.
 */

import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { findUserByStripeCustomer, updateSubscription } from '@darvin/db'
import { serverEnv } from '@/lib/env.ts'
import { stripe } from '@/lib/stripe.ts'

export const runtime = 'nodejs'

/** Everything else is acknowledged and ignored. */
const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])

export async function POST(request: Request) {
  if (!serverEnv.billingConfigured) return NextResponse.json({ received: true })

  const signature = request.headers.get('stripe-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  // Raw, before anything can re-serialize it.
  const body = await request.text()

  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(body, signature, serverEnv.stripeWebhookSecret)
  } catch (error) {
    // A bad signature is either a misconfiguration or a forgery. Both are 400,
    // and neither should be retried.
    console.error('[webhooks/stripe] signature verification failed', error)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (!HANDLED.has(event.type)) return NextResponse.json({ received: true })

  try {
    await apply(event)
  } catch (error) {
    // Our failure, so ask for a retry — the event itself was valid.
    console.error(`[webhooks/stripe] could not apply ${event.type}`, error)
    return NextResponse.json({ error: 'Could not process event' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

async function apply(event: Stripe.Event): Promise<void> {
  const subscription = await subscriptionFrom(event)
  if (!subscription) return

  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id

  // The metadata is a fallback: it is set at checkout, but a subscription
  // edited in the Stripe dashboard arrives without it.
  const userId =
    (subscription.metadata?.['userId'] as string | undefined) ?? (await findUserByStripeCustomer(customerId))

  if (!userId) {
    // Someone else's Stripe account, or a customer we never recorded. Dropping
    // it is correct; retrying would never succeed.
    console.warn('[webhooks/stripe] no account for customer', customerId)
    return
  }

  const active = subscription.status === 'active' || subscription.status === 'trialing'
  const periodEndSeconds = (subscription as unknown as { current_period_end?: number }).current_period_end

  await updateSubscription(userId, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    // Access follows Stripe's status, never the event type: a 'deleted' event
    // for a subscription still inside its paid period should not cut access
    // early, and `status` already says which it is.
    plan: active ? 'pro' : 'free',
    status: subscription.status,
    periodEnd: periodEndSeconds ? new Date(periodEndSeconds * 1000) : null,
  })
}

/** Checkout carries a subscription id; the subscription events carry the object. */
async function subscriptionFrom(event: Stripe.Event): Promise<Stripe.Subscription | null> {
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    if (!session.subscription) return null
    const id = typeof session.subscription === 'string' ? session.subscription : session.subscription.id
    return stripe().subscriptions.retrieve(id)
  }
  return event.data.object as Stripe.Subscription
}
