/**
 * Razorpay's view of the truth, written into ours.
 *
 * This route, not the browser, is what decides whether an account is on Pro.
 * The verify route makes the UI correct a second earlier; everything after
 * that first payment — renewals, failed charges, cancellations, the end of the
 * cycle — only ever arrives here.
 *
 * Four things it gets right on purpose, because each is a known way to get it
 * wrong:
 *
 *   The signature is checked against the RAW body, read before anything parses
 *   it. Parsing and re-serializing changes the bytes and every signature then
 *   fails — the commonest reason a webhook "just doesn't work".
 *
 *   The signing key is the WEBHOOK secret, which Razorpay generates per webhook
 *   in the dashboard. It is not the API secret. Using the API secret here fails
 *   in exactly the same way as a wrong body, which is why it costs people days.
 *
 *   Handlers are idempotent AND order-independent. Razorpay retries until
 *   acknowledged, may deliver an event twice after a success, and does not
 *   guarantee ordering — so every write is a set-to-state read from the event's
 *   own subscription entity, never an increment.
 *
 *   A 200 is returned for events we do not handle and for events we cannot
 *   attribute. A non-2xx makes Razorpay retry on a schedule for hours, so
 *   answering "not for us" with an error turns one stray event into a retry
 *   loop that outlives the deploy.
 */

import { NextResponse } from 'next/server'
import { findUserByBillingSubscription, updateSubscription } from '@darvin/db'
import { serverEnv } from '@/lib/env.ts'
import { isPaidStatus, verifyWebhookSignature, type RazorpaySubscription } from '@/lib/razorpay.ts'

export const runtime = 'nodejs'

/**
 * Every subscription lifecycle event. They are all handled the same way — read
 * the status off the entity — because the entity is authoritative and the
 * event name is only a hint about why it was sent.
 *
 * `subscription.charged` is included for the period end it carries on renewal.
 */
const HANDLED = new Set([
  'subscription.authenticated',
  'subscription.activated',
  'subscription.charged',
  'subscription.pending',
  'subscription.halted',
  'subscription.cancelled',
  'subscription.completed',
  'subscription.paused',
  'subscription.resumed',
  'subscription.updated',
])

interface RazorpayEvent {
  event?: unknown
  payload?: { subscription?: { entity?: RazorpaySubscription } }
}

export async function POST(request: Request) {
  if (!serverEnv.billingConfigured) return NextResponse.json({ received: true })

  if (!serverEnv.webhookConfigured) {
    // Loud, because this is the failure that silently takes money without ever
    // granting the plan. Still a 200: retrying cannot fix a missing secret.
    console.error(
      '[webhooks/razorpay] RAZORPAY_WEBHOOK_SECRET is not set — subscription events cannot be verified ' +
        'and are being dropped. Payments will succeed and accounts will never be upgraded.',
    )
    return NextResponse.json({ received: true })
  }

  const signature = request.headers.get('x-razorpay-signature')
  if (!signature) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  // Raw, before anything can re-serialize it.
  const body = await request.text()

  if (!verifyWebhookSignature(body, signature)) {
    // A bad signature is either a misconfiguration or a forgery. Both are 400,
    // and neither should be retried.
    console.error('[webhooks/razorpay] signature verification failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: RazorpayEvent
  try {
    event = JSON.parse(body) as RazorpayEvent
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }

  const name = typeof event.event === 'string' ? event.event : ''
  if (!HANDLED.has(name)) return NextResponse.json({ received: true })

  try {
    await apply(event)
  } catch (error) {
    // Our failure, so ask for a retry — the event itself was valid and signed.
    console.error(`[webhooks/razorpay] could not apply ${name}`, error)
    return NextResponse.json({ error: 'Could not process event' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

async function apply(event: RazorpayEvent): Promise<void> {
  const subscription = event.payload?.subscription?.entity
  if (!subscription?.id) return

  // `notes` is set when we create the subscription and rides along on every
  // event Razorpay will ever send about it. The lookup is the fallback, for a
  // subscription created or edited in the Razorpay dashboard, which carries no
  // notes of ours.
  const userId = subscription.notes?.['userId'] ?? (await findUserByBillingSubscription(subscription.id))

  if (!userId) {
    // Someone else's Razorpay account, or a subscription we never recorded.
    // Dropping it is correct; retrying would never succeed.
    console.warn('[webhooks/razorpay] no account for subscription', subscription.id)
    return
  }

  await updateSubscription(userId, {
    billingSubscriptionId: subscription.id,
    billingCustomerId: subscription.customer_id ?? null,
    // Access follows the STATUS on the entity, never the event name. A
    // `cancelled` event for a subscription still inside its paid period must
    // not cut access early, and `current_end` is what says when it ends.
    plan: isPaidStatus(subscription.status) ? 'pro' : 'free',
    status: subscription.status,
    periodEnd: subscription.current_end ? new Date(subscription.current_end * 1000) : null,
  })
}
