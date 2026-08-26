/**
 * Cancel at the end of the paid period.
 *
 * Stripe's billing portal used to own this and everything around it. Razorpay
 * has no equivalent, so cancellation is ours to build — and only cancellation:
 * receipts, card updates and failed-charge notices are emailed to the payer by
 * Razorpay directly, which is where the customer will look for them anyway.
 *
 * `cancel_at_cycle_end` rather than an immediate stop. Somebody who paid for
 * this month keeps this month; taking away access they have already bought is
 * both wrong and the fastest route to a chargeback. The plan is left at 'pro'
 * for that reason — access follows `periodEnd`, and the webhook flips it when
 * the period actually ends.
 */

import { NextResponse } from 'next/server'
import { getSubscription, updateSubscription } from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'
import { serverEnv } from '@/lib/env.ts'
import { cancelSubscription } from '@/lib/razorpay.ts'

export const runtime = 'nodejs'

export async function POST() {
  if (!serverEnv.billingConfigured) {
    return NextResponse.json({ error: 'Billing is not configured on this deployment.' }, { status: 503 })
  }

  const viewer = await getViewer()
  if (viewer.kind !== 'user') return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  const subscription = await getSubscription(viewer.userId)
  if (!subscription?.billingSubscriptionId) {
    return NextResponse.json({ error: 'There is no subscription to cancel.' }, { status: 400 })
  }

  try {
    const cancelled = await cancelSubscription(subscription.billingSubscriptionId)

    await updateSubscription(viewer.userId, {
      status: cancelled.status,
      periodEnd: cancelled.current_end ? new Date(cancelled.current_end * 1000) : subscription.periodEnd,
    })

    return NextResponse.json({ status: cancelled.status })
  } catch (error) {
    console.error('[billing/cancel] could not cancel', error)
    return NextResponse.json({ error: 'Could not cancel the subscription. Please try again.' }, { status: 500 })
  }
}
