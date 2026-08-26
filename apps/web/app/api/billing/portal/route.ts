/**
 * A link into Stripe's billing portal.
 *
 * There is no cancellation UI in this product and there should not be. The
 * portal already handles cancelling, changing card, invoices, tax details and
 * dunning — all of which have to be right, and none of which is a differentiator.
 */

import { NextResponse } from 'next/server'
import { getSubscription } from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'
import { serverEnv } from '@/lib/env.ts'
import { stripe } from '@/lib/stripe.ts'

export const runtime = 'nodejs'

export async function POST() {
  if (!serverEnv.billingConfigured) {
    return NextResponse.json({ error: 'Billing is not configured on this deployment.' }, { status: 503 })
  }

  const viewer = await getViewer()
  if (viewer.kind !== 'user') return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const subscription = await getSubscription(viewer.userId)
  if (!subscription?.stripeCustomerId) {
    return NextResponse.json({ error: 'No billing history yet.' }, { status: 400 })
  }

  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${serverEnv.appUrl}/settings/billing`,
    })
    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('[billing/portal] could not open the portal', error)
    return NextResponse.json({ error: 'Could not open the billing portal.' }, { status: 500 })
  }
}
