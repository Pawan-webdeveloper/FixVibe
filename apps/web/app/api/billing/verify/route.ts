/**
 * Confirm the payment the browser just reported.
 *
 * The webhook remains authoritative — it is the only path that runs when the
 * customer closes the tab at the wrong moment, and it is the one that handles
 * renewals, failures and cancellations forever after. This route exists so the
 * UI can be correct in the second after payment instead of showing a free-tier
 * page until a webhook lands.
 *
 * Which means the signature check here is not optional. All three values come
 * from the client; without verifying them, anyone could POST a subscription id
 * and be shown an upgraded product.
 *
 * Even verified, the subscription is re-fetched from Razorpay rather than
 * trusted: a valid signature proves the payment happened, not what state the
 * subscription is in now.
 */

import { NextResponse } from 'next/server'
import { getSubscription, updateSubscription } from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'
import { serverEnv } from '@/lib/env.ts'
import { fetchSubscription, isPaidStatus, verifyCheckoutSignature } from '@/lib/razorpay.ts'

export const runtime = 'nodejs'

interface Body {
  razorpay_payment_id?: unknown
  razorpay_subscription_id?: unknown
  razorpay_signature?: unknown
}

export async function POST(request: Request) {
  if (!serverEnv.billingConfigured) {
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 503 })
  }

  const viewer = await getViewer()
  if (viewer.kind !== 'user') return NextResponse.json({ error: 'Sign in first.' }, { status: 401 })

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const paymentId = str(body.razorpay_payment_id)
  const subscriptionId = str(body.razorpay_subscription_id)
  const signature = str(body.razorpay_signature)
  if (!paymentId || !subscriptionId || !signature) {
    return NextResponse.json({ error: 'Incomplete payment details.' }, { status: 400 })
  }

  if (!verifyCheckoutSignature({ paymentId, subscriptionId, signature })) {
    console.warn('[billing/verify] bad signature for', subscriptionId)
    return NextResponse.json({ error: 'Could not verify that payment.' }, { status: 400 })
  }

  // The signature proves a real payment against SOME subscription. This proves
  // it was one we created for THIS account — otherwise a signed response from
  // one customer's payment could be replayed to upgrade another.
  const ours = await getSubscription(viewer.userId)
  if (ours?.billingSubscriptionId !== subscriptionId) {
    console.warn('[billing/verify] subscription does not belong to the signed-in account', subscriptionId)
    return NextResponse.json({ error: 'Could not verify that payment.' }, { status: 400 })
  }

  try {
    const subscription = await fetchSubscription(subscriptionId)
    const paid = isPaidStatus(subscription.status)

    await updateSubscription(viewer.userId, {
      billingSubscriptionId: subscription.id,
      billingCustomerId: subscription.customer_id ?? null,
      plan: paid ? 'pro' : 'free',
      status: subscription.status,
      periodEnd: subscription.current_end ? new Date(subscription.current_end * 1000) : null,
    })

    return NextResponse.json({ plan: paid ? 'pro' : 'free', status: subscription.status })
  } catch (error) {
    // The payment is real and the webhook will settle it; the customer just
    // sees the page update a moment later than it could have.
    console.error('[billing/verify] could not read the subscription back', error)
    return NextResponse.json({ error: 'Payment received. Refresh in a moment.' }, { status: 202 })
  }
}

function str(value: unknown): string {
  return typeof value === 'string' && value.length > 0 && value.length < 200 ? value : ''
}
