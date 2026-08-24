/**
 * Start a Stripe Checkout session.
 *
 * Checkout rather than a custom form, deliberately: it handles cards, wallets,
 * 3-D Secure, tax and SCA, and it means no payment detail ever touches this
 * server — which removes the entire question of how carefully we handle it.
 */

import { NextResponse } from 'next/server'
import { getSubscription, updateSubscription } from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'
import { serverEnv } from '@/lib/env.ts'
import { stripe } from '@/lib/stripe.ts'

export const runtime = 'nodejs'

export async function POST() {
  if (!serverEnv.billingConfigured) {
    return NextResponse.json({ error: 'Billing is not configured on this deployment.' }, { status: 503 })
  }

  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Sign in before upgrading.' }, { status: 401 })
  }

  const subscription = await getSubscription(viewer.userId)
  if (!subscription) {
    return NextResponse.json({ error: 'Account is not set up. Sign out and back in.' }, { status: 400 })
  }

  try {
    // Reusing the customer keeps one billing history per account. Creating a
    // second on every checkout is how a user ends up paying twice with no
    // single place to cancel.
    const customerId =
      subscription.stripeCustomerId ??
      (await stripe().customers.create({ metadata: { userId: viewer.userId } })).id

    if (!subscription.stripeCustomerId) {
      await updateSubscription(viewer.userId, { stripeCustomerId: customerId })
    }

    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: serverEnv.stripeProPriceId, quantity: 1 }],
      success_url: `${serverEnv.appUrl}/settings/billing?upgraded=1`,
      cancel_url: `${serverEnv.appUrl}/pricing`,
      // The webhook is authoritative, but this makes an event traceable to an
      // account even if the customer lookup ever fails.
      subscription_data: { metadata: { userId: viewer.userId } },
      allow_promotion_codes: true,
    })

    if (!session.url) throw new Error('Stripe returned a session with no URL')
    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('[billing/checkout] could not start a session', error)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 })
  }
}
