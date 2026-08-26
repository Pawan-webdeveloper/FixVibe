/**
 * Razorpay, over plain fetch.
 *
 * No SDK. Razorpay's REST API is HTTP Basic auth and JSON, the official client
 * is CommonJS with permissive types, and the three calls this product makes
 * are twenty lines. A dependency here would buy nothing and cost a shape we do
 * not control.
 *
 * ## How Razorpay differs from Stripe, since this replaced it
 *
 * There is no hosted checkout page to redirect to. Razorpay Checkout is a
 * JavaScript modal the browser opens over our own page, so the server hands
 * the client a `subscription_id` and the client takes it from there — see
 * components/billing/billing-button.tsx.
 *
 * There is no customer portal. Stripe's handles cancellation, card changes,
 * invoices and dunning, and the previous version of this file deliberately
 * delegated all of it. Razorpay has no equivalent, so cancellation is ours to
 * build; card changes and invoices live in the emails Razorpay sends the
 * payer.
 *
 * Two signatures are verified here and they are NOT the same computation,
 * which is the single easiest thing to get wrong in this integration:
 *
 *   the checkout handler — HMAC over `payment_id|subscription_id` with the
 *     API SECRET. (For one-time orders Razorpay reverses the operands to
 *     `order_id|payment_id`; this product uses subscriptions.)
 *
 *   the webhook — HMAC over the RAW request body with the WEBHOOK SECRET,
 *     which is a different secret entirely, set per-webhook in the dashboard.
 */

import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { serverEnv } from './env.ts'

const API = 'https://api.razorpay.com/v1'

/**
 * Billing cycles to request. Razorpay makes `total_count` mandatory — there is
 * no "until cancelled" — so this is the largest safe value for a monthly plan,
 * about eight years. A subscription that actually reaches the end arrives as
 * `subscription.completed`, which the webhook treats as a downgrade.
 */
const MONTHLY_CYCLES = 100

export interface RazorpaySubscription {
  id: string
  /** created | authenticated | active | pending | halted | cancelled | completed | expired | paused */
  status: string
  plan_id?: string
  customer_id?: string | null
  /** Unix seconds. Null until the subscription is authenticated. */
  current_end?: number | null
  notes?: Record<string, string> | null
}

/**
 * Carries the HTTP status, because Razorpay's 401 is ambiguous in a way that
 * matters: identical body whether the credentials are wrong or the account
 * simply does not have the product enabled. The routes use the status to say
 * something useful in the log instead of "could not start checkout".
 */
export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'RazorpayError'
  }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const credentials = Buffer.from(`${serverEnv.razorpayKeyId}:${serverEnv.razorpayKeySecret}`).toString('base64')

  const response = await fetch(`${API}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })

  const text = await response.text()
  if (!response.ok) {
    // Razorpay puts a usable sentence in error.description. It is logged, never
    // returned to the browser: it can name plan ids and account state.
    let description = text.slice(0, 300)
    try {
      description = (JSON.parse(text) as { error?: { description?: string } }).error?.description ?? description
    } catch {
      // Not JSON — an upstream proxy error page. The raw prefix is the detail.
    }
    throw new RazorpayError(
      `Razorpay ${init?.method ?? 'GET'} ${path} → ${response.status}: ${description}`,
      response.status,
    )
  }

  return JSON.parse(text) as T
}

/**
 * `notes` carries our user id through to every webhook Razorpay will ever send
 * about this subscription, which is the primary way an event is attributed to
 * an account. Values must be strings.
 */
export function createSubscription(userId: string): Promise<RazorpaySubscription> {
  return call<RazorpaySubscription>('/subscriptions', {
    method: 'POST',
    body: {
      plan_id: serverEnv.razorpayProPlanId,
      total_count: MONTHLY_CYCLES,
      quantity: 1,
      // Razorpay emails the payer about charges and failures. We do not
      // reimplement dunning, so letting it do that is the whole strategy.
      customer_notify: 1,
      notes: { userId },
    },
  })
}

export function fetchSubscription(subscriptionId: string): Promise<RazorpaySubscription> {
  return call<RazorpaySubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`)
}

/**
 * Cancels at the end of the paid period, not immediately.
 *
 * Someone who paid for this month keeps this month. Cancelling at once would
 * take away access they already bought, which is both wrong and the fastest
 * route to a chargeback.
 */
export function cancelSubscription(subscriptionId: string): Promise<RazorpaySubscription> {
  return call<RazorpaySubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: 'POST',
    body: { cancel_at_cycle_end: 1 },
  })
}

/**
 * The signature Razorpay Checkout hands the browser after a successful
 * payment: HMAC-SHA256 of `payment_id|subscription_id` keyed by the API
 * SECRET.
 *
 * Worth verifying even though the webhook is authoritative, because these
 * three values arrive from the client and are therefore attacker-controlled.
 * Without this, anyone could POST a made-up subscription id to the verify
 * route and be shown an upgraded UI until the truth caught up.
 */
export function verifyCheckoutSignature(input: {
  paymentId: string
  subscriptionId: string
  signature: string
}): boolean {
  const expected = createHmac('sha256', serverEnv.razorpayKeySecret)
    .update(`${input.paymentId}|${input.subscriptionId}`)
    .digest('hex')
  return safeEqual(expected, input.signature)
}

/**
 * The webhook signature: HMAC-SHA256 of the RAW body keyed by the WEBHOOK
 * secret — a different secret from the API one, configured per webhook in the
 * dashboard.
 *
 * The body must be the bytes as received. Parsing and re-serializing changes
 * them (key order, whitespace, unicode escaping) and every signature then
 * fails, which is the commonest reason a webhook "just doesn't work".
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const expected = createHmac('sha256', serverEnv.razorpayWebhookSecret).update(rawBody).digest('hex')
  return safeEqual(expected, signature)
}

/** Constant time, and length-safe: timingSafeEqual throws on a length mismatch. */
function safeEqual(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(presented, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Which Razorpay statuses mean "this account has paid for Pro".
 *
 * `authenticated` is included: the mandate is approved and the first charge is
 * scheduled, so the customer has done everything asked of them and must not
 * see a free-tier product while Razorpay's scheduler catches up.
 *
 * `pending` and `halted` are NOT included. Those mean a charge failed and
 * Razorpay is retrying or has given up. Razorpay is emailing the customer
 * about it and the billing page says so plainly.
 */
export function isPaidStatus(status: string): boolean {
  return status === 'active' || status === 'authenticated'
}

export { serverEnv }
