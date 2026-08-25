/**
 * Create a Razorpay subscription and hand the browser what it needs to open
 * Checkout.
 *
 * Unlike Stripe there is no hosted page to redirect to: Razorpay Checkout is a
 * modal rendered by their script on our own page. So this returns ids rather
 * than a URL, and the client opens the modal — see
 * components/billing/billing-button.tsx.
 *
 * No card detail passes through this server in either design, which is the
 * property worth keeping: it removes the entire question of how carefully we
 * would have to handle it.
 */

import { NextResponse } from 'next/server'
import { getSubscription, getUserContext, updateSubscription } from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'
import { serverEnv } from '@/lib/env.ts'
import { createSubscription, RazorpayError } from '@/lib/razorpay.ts'
import { PLANS } from '@/lib/plans.ts'

export const runtime = 'nodejs'

export async function POST() {
  if (!serverEnv.billingConfigured) {
    return NextResponse.json({ error: 'Billing is not configured on this deployment.' }, { status: 503 })
  }

  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Sign in before upgrading.' }, { status: 401 })
  }

  // The email only prefills the Razorpay modal, so a missing one costs the
  // customer a keystroke rather than the upgrade.
  const [existing, account] = await Promise.all([getSubscription(viewer.userId), getUserContext(viewer.userId)])
  if (!existing) {
    return NextResponse.json({ error: 'Account is not set up. Sign out and back in.' }, { status: 400 })
  }
  if (existing.plan === 'pro') {
    // Not an error state worth a 500, but creating a second subscription for
    // someone already paying is how a customer ends up charged twice with no
    // single place to cancel.
    return NextResponse.json({ error: 'This account is already on Pro.' }, { status: 409 })
  }

  try {
    const subscription = await createSubscription(viewer.userId)

    // Recorded BEFORE the customer pays. Razorpay can deliver
    // `subscription.charged` within seconds, and a webhook that arrives before
    // we know the id has nothing to match against — `notes.userId` covers it,
    // but only for subscriptions we created, and this is what makes the
    // fallback lookup work at all.
    await updateSubscription(viewer.userId, {
      billingSubscriptionId: subscription.id,
      status: subscription.status,
    })

    return NextResponse.json({
      subscriptionId: subscription.id,
      // Returned rather than read from NEXT_PUBLIC_RAZORPAY_KEY_ID in the
      // browser: this is guaranteed to be the key whose secret created the
      // subscription. A public var that drifts from the server's key produces
      // a modal that fails with nothing useful on screen.
      keyId: serverEnv.razorpayKeyId,
      planName: PLANS.pro.name,
      email: account?.email,
    })
  } catch (error) {
    // A 401 here almost never means the keys are wrong — the same request
    // against /payments succeeds with them. Razorpay provisions Subscriptions
    // separately, and returns exactly the same "Unauthorized" body for an
    // account that has not enabled it. Saying so in the log is the difference
    // between a two-minute fix and two days of regenerating keys.
    if (error instanceof RazorpayError && error.status === 401) {
      console.error(
        '[billing/checkout] Razorpay returned 401. If the keys work elsewhere, the Subscriptions ' +
          'product is not enabled on this account — run `pnpm razorpay:check` to confirm which it is.',
        error.message,
      )
      return NextResponse.json({ error: 'Billing is temporarily unavailable.' }, { status: 503 })
    }

    // Razorpay's message can name plan ids and account state, so it is logged
    // and never returned.
    console.error('[billing/checkout] could not create a subscription', error)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 })
  }
}
