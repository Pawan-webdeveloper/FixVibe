/**
 * Environment access, in one place, validated once.
 *
 * Two things this buys. A missing variable fails at boot with a sentence
 * naming it, instead of surfacing as `undefined` inside a database driver at
 * 2am. And server-only secrets stay importable only from server code: a client
 * component that reaches for `serverEnv` fails the build, which is a cheaper
 * way to keep a secret out of a JS bundle than remembering not to.
 *
 * Hand-written rather than schema-validated: fifteen lines with no dependency
 * read better than a library for a handful of strings.
 */

import 'server-only'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        "Set it in your deployment's environment (or copy .env.example to .env " +
        'at the repository root when running locally).',
    )
  }
  return value
}

export const serverEnv = {
  /** Postgres. The one variable this phase actually needs. */
  get databaseUrl() {
    return required('DATABASE_URL')
  },

  /**
   * Supabase Auth. The publishable key is also NEXT_PUBLIC_ — same value, read
   * here for server code that wants a typed access path rather than a raw
   * process.env lookup.
   */
  get supabaseUrl() {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  },
  get supabaseAnonKey() {
    return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? ''
  },

  /**
   * Salt for hashing visitor addresses before they reach the database. Without
   * one, a hash of an IPv4 address is trivially reversed — there are only four
   * billion of them, which is minutes of brute force.
   */
  get ipHashSalt() {
    return required('IP_HASH_SALT')
  },

  /** Razorpay. Absent until billing is configured; the routes say so cleanly. */
  get razorpayKeyId() {
    return required('RAZORPAY_KEY_ID')
  },
  get razorpayKeySecret() {
    return required('RAZORPAY_KEY_SECRET')
  },
  /** The Plan created in the Razorpay dashboard. Its amount is the real price. */
  get razorpayProPlanId() {
    return required('RAZORPAY_PLAN_PRO_MONTHLY')
  },
  /**
   * A DIFFERENT secret from the API one: Razorpay generates it per webhook in
   * the dashboard. Signing a webhook check with the API secret is the second
   * commonest way this integration fails.
   */
  get razorpayWebhookSecret() {
    return required('RAZORPAY_WEBHOOK_SECRET')
  },
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  },
  /**
   * True when a subscription can actually be created, so a route can refuse
   * cleanly instead of throwing. The webhook secret is deliberately NOT part
   * of this: checkout works without it, and a deployment that takes money
   * while silently dropping webhooks is a worse failure than one that cannot
   * take money at all — so the webhook route checks for it separately and
   * complains loudly.
   */
  get billingConfigured() {
    return Boolean(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_PLAN_PRO_MONTHLY,
    )
  },
  get webhookConfigured() {
    return Boolean(process.env.RAZORPAY_WEBHOOK_SECRET)
  },

  /**
   * Alert email. Absent means monitoring records alerts that reach nobody, so
   * the transport logs loudly rather than failing quietly — see lib/email.ts.
   * Deliberately not part of assertServerEnv: a deployment with no mail
   * provider should still scan, and a monitoring feature nobody has enabled
   * yet is not a reason to refuse every request.
   */
  get alertsConfigured() {
    return Boolean(process.env.RESEND_API_KEY)
  },

  get isProduction() {
    return process.env.NODE_ENV === 'production'
  },
} as const

/**
 * Read at startup so a misconfigured deploy fails immediately rather than on
 * the first visitor. Called from the scan route, which is the first thing any
 * request touches.
 */
export function assertServerEnv(): void {
  void serverEnv.databaseUrl
  void serverEnv.ipHashSalt
}
