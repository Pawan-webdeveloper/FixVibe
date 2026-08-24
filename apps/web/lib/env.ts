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
        'Copy .env.example to .env at the repository root and fill it in.',
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
   * Salt for hashing visitor addresses before they reach the database. Without
   * one, a hash of an IPv4 address is trivially reversed — there are only four
   * billion of them, which is minutes of brute force.
   */
  get ipHashSalt() {
    return required('IP_HASH_SALT')
  },

  /** Stripe. Absent until billing is configured; the routes below say so. */
  get stripeSecretKey() {
    return required('STRIPE_SECRET_KEY')
  },
  get stripeWebhookSecret() {
    return required('STRIPE_WEBHOOK_SECRET')
  },
  get stripeProPriceId() {
    return required('STRIPE_PRICE_PRO_MONTHLY')
  },
  /** Where Stripe sends the customer back to. */
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  },
  /** True when billing can actually run, so a route can refuse cleanly. */
  get billingConfigured() {
    return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO_MONTHLY)
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
