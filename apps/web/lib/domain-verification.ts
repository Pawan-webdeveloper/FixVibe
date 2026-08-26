/**
 * Proving that somebody controls the domain they are asking us to probe.
 *
 * This is the gate on the two most intrusive checks in the engine — Supabase
 * row-level security and Firebase rules — which send requests to somebody
 * else's backend. Probing an endpoint you do not own is unauthorised testing
 * however gentle the request, so the proof has to be real: a value only the
 * domain's operator could publish, read back from DNS by us, never asserted by
 * the browser.
 *
 * ## Why DNS TXT and not a file or a meta tag
 *
 * A file at /.well-known/ proves control of the web server, which is not the
 * same thing — plenty of people can deploy to a path on a domain they do not
 * administer, and the whole point of this gate is who administers it. DNS is
 * the narrower claim and the harder one to fake.
 *
 * ## The host is www-stripped
 *
 * Deliberately matching verifiedHostForProject and mayTestActively, which both
 * strip it. Verifying `www.example.com` while the engine asks about
 * `example.com` would leave a project verified and still refused, with nothing
 * on screen to explain why.
 */

import 'server-only'
import { Resolver } from 'node:dns/promises'

/** Namespaced so the record is self-describing in somebody's zone file. */
export const RECORD_PREFIX = '_darvin'

/** Where the owner publishes the proof. */
export function recordName(host: string): string {
  return `${RECORD_PREFIX}.${host}`
}

/**
 * A TXT record arrives as an array of chunks — the protocol caps each string
 * at 255 bytes, so a long value is split and must be rejoined before it can be
 * compared to anything.
 */
export type TxtResolver = (name: string) => Promise<string[][]>

export type VerifyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly found: readonly string[] }

/**
 * Short, and it retries once. A verification page is somebody standing at
 * their DNS provider waiting, and the honest answer to a slow resolver is "not
 * yet, try again" rather than a request that hangs for thirty seconds.
 */
const DNS_TIMEOUT_MS = 5_000
const DNS_TRIES = 2

function systemResolver(): TxtResolver {
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: DNS_TRIES })
  return (name) => resolver.resolveTxt(name)
}

/**
 * Node reports "there is no such name" and "the name exists with no TXT" as
 * two different codes, and both mean the same thing to somebody who has just
 * added a record: it has not propagated yet. Anything else is a resolver
 * problem and must not read as "you did it wrong".
 */
function describeLookupFailure(error: unknown, name: string): string {
  const code = (error as { code?: string } | null)?.code
  switch (code) {
    case 'ENOTFOUND':
    case 'ENODATA':
      return `No TXT record found at ${name}. DNS changes can take a few minutes to propagate.`
    case 'ETIMEOUT':
    case 'ETIMEDOUT':
      return 'The DNS lookup timed out. This is our resolver, not your record — try again.'
    default:
      return `Could not read DNS for ${name}${code ? ` (${code})` : ''}. Try again in a moment.`
  }
}

export async function checkDnsProof(
  host: string,
  token: string,
  resolve: TxtResolver = systemResolver(),
): Promise<VerifyOutcome> {
  const name = recordName(host)

  let records: string[][]
  try {
    records = await resolve(name)
  } catch (error) {
    return { ok: false, reason: describeLookupFailure(error, name), found: [] }
  }

  // Chunks rejoined, whitespace trimmed. A DNS UI that wraps a long value or a
  // paste that picked up a trailing space must not fail a correct record.
  const values = records.map((chunks) => chunks.join('').trim()).filter((value) => value !== '')

  if (values.includes(token)) return { ok: true }

  if (values.length === 0) {
    return {
      ok: false,
      reason: `No TXT record found at ${name}. DNS changes can take a few minutes to propagate.`,
      found: [],
    }
  }

  return {
    ok: false,
    reason:
      `Found ${values.length} TXT record${values.length === 1 ? '' : 's'} at ${name}, ` +
      'but none matched. Check the value was copied whole.',
    found: values,
  }
}
