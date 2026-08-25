/**
 * The two signature checks, which are the whole security boundary of billing.
 *
 * Everything else in the payment flow is arranged so that these two functions
 * are the only thing standing between "the browser said so" and "this account
 * is on Pro". If either is wrong, an upgrade is free for anyone who can read
 * the network tab.
 *
 * They are also the easiest part of a Razorpay integration to get subtly
 * wrong, in three specific ways this file pins:
 *
 *   The two computations use DIFFERENT secrets. The checkout signature is
 *   keyed by the API secret; the webhook by a per-webhook secret from the
 *   dashboard. Signing one with the other fails exactly like a wrong body.
 *
 *   The checkout operands are `payment_id|subscription_id`. For one-time
 *   orders Razorpay reverses them to `order_id|payment_id`, and this product
 *   uses subscriptions — so an implementation copied from an orders tutorial
 *   verifies nothing while appearing to work on the happy path, because both
 *   sides would be wrong together only if you also wrote the signer.
 *
 *   The webhook is HMAC over RAW BYTES. Parsing and re-serializing changes
 *   them, so a route that reads `await request.json()` first can never verify
 *   a real webhook.
 */

import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

const API_SECRET = 'test_api_secret_value'
const WEBHOOK_SECRET = 'test_webhook_secret_value'

// Set before the module is imported: serverEnv reads process.env lazily, but
// the getters throw on a missing variable the moment they are touched.
beforeAll(() => {
  process.env['RAZORPAY_KEY_ID'] = 'rzp_test_example'
  process.env['RAZORPAY_KEY_SECRET'] = API_SECRET
  process.env['RAZORPAY_PLAN_PRO_MONTHLY'] = 'plan_example'
  process.env['RAZORPAY_WEBHOOK_SECRET'] = WEBHOOK_SECRET
})

const { verifyCheckoutSignature, verifyWebhookSignature, isPaidStatus } = await import('../lib/razorpay.ts')

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('hex')

const PAYMENT = 'pay_ABC123'
const SUBSCRIPTION = 'sub_XYZ789'

describe('verifyCheckoutSignature', () => {
  it('accepts a signature Razorpay would actually send', () => {
    // Subscriptions: payment_id first, subscription_id second.
    const signature = sign(`${PAYMENT}|${SUBSCRIPTION}`, API_SECRET)
    expect(verifyCheckoutSignature({ paymentId: PAYMENT, subscriptionId: SUBSCRIPTION, signature })).toBe(true)
  })

  it('rejects the orders-style operand order', () => {
    // This is what an implementation copied from an orders tutorial produces,
    // and it must not verify — otherwise the check is decorative.
    const signature = sign(`${SUBSCRIPTION}|${PAYMENT}`, API_SECRET)
    expect(verifyCheckoutSignature({ paymentId: PAYMENT, subscriptionId: SUBSCRIPTION, signature })).toBe(false)
  })

  it('rejects a signature made with the webhook secret', () => {
    const signature = sign(`${PAYMENT}|${SUBSCRIPTION}`, WEBHOOK_SECRET)
    expect(verifyCheckoutSignature({ paymentId: PAYMENT, subscriptionId: SUBSCRIPTION, signature })).toBe(false)
  })

  it('rejects a signature that belongs to a different payment', () => {
    // The replay an attacker actually has: a valid signature from their own
    // real payment, presented against somebody else's subscription id.
    const signature = sign(`${PAYMENT}|sub_SOMEONE_ELSE`, API_SECRET)
    expect(verifyCheckoutSignature({ paymentId: PAYMENT, subscriptionId: SUBSCRIPTION, signature })).toBe(false)
  })

  it('rejects empty, truncated and overlong signatures without throwing', () => {
    // timingSafeEqual throws on a length mismatch, so the length guard is not
    // an optimisation — without it these inputs crash the route.
    const valid = sign(`${PAYMENT}|${SUBSCRIPTION}`, API_SECRET)
    for (const signature of ['', valid.slice(0, -1), `${valid}0`, 'not-hex-at-all']) {
      expect(verifyCheckoutSignature({ paymentId: PAYMENT, subscriptionId: SUBSCRIPTION, signature })).toBe(false)
    }
  })
})

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify({ event: 'subscription.activated', payload: { subscription: { entity: { id: 'sub_1' } } } })

  it('accepts a signature over the exact bytes received', () => {
    expect(verifyWebhookSignature(body, sign(body, WEBHOOK_SECRET))).toBe(true)
  })

  it('rejects a signature over re-serialized JSON', () => {
    // The failure mode this exists to catch: a route that parses first. Same
    // object, different bytes, and every real webhook would be rejected.
    const reserialized = JSON.stringify(JSON.parse(body))
    const spaced = JSON.stringify(JSON.parse(body), null, 2)
    expect(reserialized).toBe(body) // identical here...
    expect(verifyWebhookSignature(spaced, sign(body, WEBHOOK_SECRET))).toBe(false) // ...but not once formatting differs
  })

  it('rejects a signature made with the API secret', () => {
    expect(verifyWebhookSignature(body, sign(body, API_SECRET))).toBe(false)
  })

  it('rejects a tampered body', () => {
    const signature = sign(body, WEBHOOK_SECRET)
    const tampered = body.replace('subscription.activated', 'subscription.charged')
    expect(verifyWebhookSignature(tampered, signature)).toBe(false)
  })

  it('rejects a missing signature without throwing', () => {
    expect(verifyWebhookSignature(body, '')).toBe(false)
  })
})

describe('isPaidStatus', () => {
  it('counts an authenticated mandate as paid', () => {
    // The customer has done everything asked of them and the first charge is
    // scheduled; showing them a free-tier product while Razorpay's scheduler
    // catches up would be our bug, not their problem.
    expect(isPaidStatus('authenticated')).toBe(true)
    expect(isPaidStatus('active')).toBe(true)
  })

  it('does not count a failing or finished subscription as paid', () => {
    for (const status of ['created', 'pending', 'halted', 'cancelled', 'completed', 'expired', 'paused']) {
      expect(isPaidStatus(status), `${status} must not grant Pro`).toBe(false)
    }
  })
})
