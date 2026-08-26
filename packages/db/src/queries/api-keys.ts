/**
 * API keys — minting, listing, revoking, and the one lookup that turns a
 * bearer token back into an account.
 *
 * A key is a password that never expires, is copied into CI configuration, and
 * is pasted into terminals. Three rules follow from that, and each one is a
 * decision this file makes rather than leaving to its callers:
 *
 *  1. The plaintext is returned EXACTLY ONCE, from `createApiKey`, and is
 *     never stored. `resolveApiKey` matches on a hash, so a database dump
 *     cannot be replayed against the API. There is deliberately no function
 *     that reads a key back — not even for the account that owns it.
 *
 *  2. SHA-256, not bcrypt. See the note on the `apiKeys` table: the secret is
 *     256 CSPRNG bits, so a slow hash defends against nothing and costs
 *     100 ms on every request the API serves.
 *
 *  3. Revocation is a DELETE, not a `revokedAt` column. Soft deletion means
 *     every lookup must remember to filter, and the one that forgets keeps a
 *     compromised key working. Deleting the row is fail-closed by
 *     construction, which is the property that matters when the thing being
 *     turned off is a credential someone has just found in a public log.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, count, desc, eq } from 'drizzle-orm'
import { db } from '../client.ts'
import { apiKeys, type ApiKey } from '../schema.ts'
import type { Viewer } from './viewer.ts'

/**
 * Namespaced so a leaked key is recognisable on sight — in a log, in a diff,
 * in a screenshot — and so secret scanners can be taught one pattern. A key
 * that looks like any other hex string gets committed and stays committed.
 */
const KEY_PREFIX = 'dv_'

/** 32 bytes. Hex rather than base64url so a double-click selects the whole token. */
const SECRET_BYTES = 32

/**
 * How much of the plaintext is kept in the clear for display. Eight hex
 * characters of a 64-character secret leaves 224 bits unguessable, and is
 * enough to match a key found in a build log to a row in the list.
 */
const PREFIX_CHARS = KEY_PREFIX.length + 8

/** `dv_` followed by exactly 64 lowercase hex characters. */
const KEY_SHAPE = new RegExp(`^${KEY_PREFIX}[0-9a-f]{${SECRET_BYTES * 2}}$`)

/**
 * Skip the write when the stored timestamp is already recent enough to answer
 * "is this key still in use?". Without this, every request the API serves is
 * also an UPDATE on a hot row, and a busy key serialises on its own bookkeeping.
 */
const TOUCH_INTERVAL_MS = 5 * 60_000

/**
 * Named for the moment rather than for the row: `NewApiKey` is already the
 * table's insert type, and the two are not the same thing — one is what goes
 * into Postgres, this is the only object that ever holds the plaintext.
 */
export interface MintedApiKey {
  /** Shown once, at creation, and never obtainable again. */
  plaintext: string
  key: ApiKeySummary
}

/** What the settings page may see. Note the absence of `keyHash`. */
export interface ApiKeySummary {
  id: string
  name: string | null
  prefix: string | null
  lastUsedAt: Date | null
  createdAt: Date
}

export type CreateApiKeyResult =
  | { readonly ok: true; readonly created: MintedApiKey }
  | { readonly ok: false; readonly reason: 'unauthenticated' | 'limit-reached' }

/**
 * The hash a key is stored and looked up by.
 *
 * Exported because the API-auth layer hashes an incoming header with it, and
 * two implementations of "how a key becomes a hash" is how a key stops
 * matching itself.
 */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

/** True for anything shaped like one of our keys. Cheap rejection before a query. */
export function looksLikeApiKey(value: string): boolean {
  return KEY_SHAPE.test(value)
}

function mint(): { plaintext: string; prefix: string } {
  const plaintext = `${KEY_PREFIX}${randomBytes(SECRET_BYTES).toString('hex')}`
  return { plaintext, prefix: plaintext.slice(0, PREFIX_CHARS) }
}

function summarize(row: ApiKey): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  }
}

/**
 * Mint a key for the caller's own account.
 *
 * `maxKeys` is passed in for the same reason `createProject`'s ceiling is:
 * this package must not learn what a plan costs, but it can be told a number,
 * and a caller that forgets to supply one does not compile. Zero is a
 * meaningful ceiling — it is what a plan without API access has — so the check
 * is `>=` and the free tier is refused here rather than at the route.
 */
export async function createApiKey(
  viewer: Viewer,
  name: string | null,
  maxKeys: number,
): Promise<CreateApiKeyResult> {
  if (viewer.kind !== 'user') return { ok: false, reason: 'unauthenticated' }

  const [used] = await db
    .select({ n: count() })
    .from(apiKeys)
    .where(eq(apiKeys.userId, viewer.userId))

  if ((used?.n ?? 0) >= maxKeys) return { ok: false, reason: 'limit-reached' }

  const { plaintext, prefix } = mint()
  const [row] = await db
    .insert(apiKeys)
    .values({ userId: viewer.userId, name, prefix, keyHash: hashApiKey(plaintext) })
    .returning()

  if (!row) throw new Error('createApiKey: insert returned no row')
  return { ok: true, created: { plaintext, key: summarize(row) } }
}

/** The caller's own keys, newest first. Never another account's, and never a hash. */
export async function listApiKeys(viewer: Viewer): Promise<ApiKeySummary[]> {
  if (viewer.kind !== 'user') return []

  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, viewer.userId))
    .orderBy(desc(apiKeys.createdAt))

  return rows.map(summarize)
}

/**
 * Delete a key. Returns false when it is not the caller's — the same answer as
 * "no such key", because telling a stranger that an id exists but is not
 * theirs is a fact they should not be able to learn.
 *
 * The ownership predicate is in the WHERE clause rather than in a read-then-
 * delete: one statement cannot lose a race with a concurrent transfer, and
 * cannot be reordered into deleting the row it only meant to check.
 */
export async function revokeApiKey(keyId: string, viewer: Viewer): Promise<boolean> {
  if (viewer.kind !== 'user') return false

  const deleted = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, viewer.userId)))
    .returning({ id: apiKeys.id })

  return deleted.length > 0
}

export interface ResolvedApiKey {
  userId: string
  keyId: string
}

/**
 * Turn a bearer token into the account that owns it.
 *
 * Takes no Viewer, and that is not an oversight: this function is how a Viewer
 * comes into existence. It is the one place in the query layer whose input is
 * a raw credential, which is why it does exactly one thing and returns exactly
 * two ids.
 *
 * The stored hash is compared with `timingSafeEqual` even though the lookup
 * itself is an indexed equality on that same hash. Redundant today; free; and
 * the day this becomes a scan over a small table, the redundancy is the only
 * thing standing between a key and a timing oracle.
 */
export async function resolveApiKey(plaintext: string): Promise<ResolvedApiKey | null> {
  // Rejected before the query. A malformed header should not cost a round trip,
  // and this is an unauthenticated endpoint anyone can reach.
  if (!looksLikeApiKey(plaintext)) return null

  const expected = hashApiKey(plaintext)
  const [row] = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      keyHash: apiKeys.keyHash,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, expected))
    .limit(1)

  if (!row) return null

  const a = Buffer.from(row.keyHash, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  await touch(row.id, row.lastUsedAt)
  return { userId: row.userId, keyId: row.id }
}

/**
 * Record that the key was used, at most once every few minutes.
 *
 * The value of this column is answering "can I delete this key?" months later,
 * and a five-minute resolution answers that as well as a per-request one does.
 */
async function touch(keyId: string, lastUsedAt: Date | null): Promise<void> {
  const now = Date.now()
  if (lastUsedAt && now - lastUsedAt.getTime() < TOUCH_INTERVAL_MS) return

  await db.update(apiKeys).set({ lastUsedAt: new Date(now) }).where(eq(apiKeys.id, keyId))
}
