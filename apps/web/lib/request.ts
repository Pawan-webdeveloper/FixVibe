/**
 * What we are allowed to know about the caller.
 *
 * The address is hashed before it goes anywhere: rate limiting needs to tell
 * two visitors apart, which a hash does, and it never needs to know who they
 * are, which a hash prevents. The salt matters — an unsalted hash of an IPv4
 * address is reversible in minutes, because there are only four billion of them.
 */

import 'server-only'
import { createHash } from 'node:crypto'
import { serverEnv } from './env.ts'

/**
 * Trust note: this reads `x-forwarded-for`, which a client can set freely
 * unless something in front of the app overwrites it. Vercel does. If this is
 * ever deployed behind a proxy that forwards a client-supplied value, the
 * per-visitor limit becomes bypassable and the per-target limit — which does
 * not depend on the caller's identity — is the protection that still holds.
 * That is one of the reasons there are two limits rather than one.
 */
export function clientIpHash(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  // The chain reads client, proxy1, proxy2 — the client is the first entry.
  const address = forwarded?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || 'unknown'

  return createHash('sha256').update(`${serverEnv.ipHashSalt}:${address}`).digest('hex')
}
