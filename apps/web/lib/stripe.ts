/**
 * The Stripe client, and the two facts about it worth stating once.
 *
 * It is created lazily. Billing is the last thing configured and the first
 * thing missing in a fresh clone; constructing the client at module load would
 * make every page that transitively imports this fail at boot over a key
 * nobody needs yet.
 *
 * The API version is pinned. Stripe changes shapes between versions, and an
 * unpinned client silently follows the account's default — so an upgrade made
 * in the dashboard would change what this code receives without a deploy.
 */

import 'server-only'
import Stripe from 'stripe'
import { serverEnv } from './env.ts'

let client: Stripe | null = null

export function stripe(): Stripe {
  client ??= new Stripe(serverEnv.stripeSecretKey, { apiVersion: '2026-07-29.dahlia' })
  return client
}

export { serverEnv }
