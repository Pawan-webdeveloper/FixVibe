/**
 * API keys — against a real Postgres.
 *
 *   DARVIN_DB=1 pnpm --filter @darvin/db test
 *
 * A key is the one credential this product hands out, so the tests here are
 * about what must NEVER be true rather than about what the happy path returns:
 *
 *   - the plaintext is not in the row it created
 *   - another account's key cannot be listed, revoked, or learned about
 *   - a revoked key stops authenticating immediately
 *   - the ceiling is enforced at the WRITE, not at the form that calls it
 *
 * The last one matters because `createApiKey` has three callers coming: the
 * settings page, the public API, and the MCP server. A rule enforced in one
 * caller is a rule the next caller forgets.
 */

import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../src/client.ts'
import { apiKeys, memberships, organizations, subscriptions, users } from '../src/schema.ts'
import { ensureUser } from '../src/queries/users.ts'
import {
  createApiKey,
  hashApiKey,
  listApiKeys,
  looksLikeApiKey,
  resolveApiKey,
  revokeApiKey,
} from '../src/queries/api-keys.ts'
import { ANONYMOUS, type Viewer } from '../src/queries/viewer.ts'

const live = process.env.DARVIN_DB === '1'

type UserViewer = Viewer & { kind: 'user' }

describe('key shape (no database)', () => {
  it('accepts only dv_ followed by 64 hex characters', () => {
    const hex64 = 'a'.repeat(64)
    expect(looksLikeApiKey(`dv_${hex64}`)).toBe(true)

    // Every one of these is a real thing a caller sends, and every one of them
    // must be rejected before it costs a query.
    expect(looksLikeApiKey('')).toBe(false)
    expect(looksLikeApiKey(hex64)).toBe(false) // no prefix
    expect(looksLikeApiKey(`dv_${'a'.repeat(63)}`)).toBe(false) // one short
    expect(looksLikeApiKey(`dv_${'a'.repeat(65)}`)).toBe(false) // one long
    expect(looksLikeApiKey(`dv_${'A'.repeat(64)}`)).toBe(false) // uppercase hex
    expect(looksLikeApiKey(`dv_${'g'.repeat(64)}`)).toBe(false) // not hex
    expect(looksLikeApiKey(` dv_${hex64}`)).toBe(false) // untrimmed
    expect(looksLikeApiKey(`dv_${hex64}\n`)).toBe(false) // trailing newline
  })

  it('hashes with sha256, deterministically', () => {
    const key = `dv_${'b'.repeat(64)}`
    expect(hashApiKey(key)).toBe(createHash('sha256').update(key).digest('hex'))
    expect(hashApiKey(key)).toBe(hashApiKey(key))
    expect(hashApiKey(key)).not.toBe(hashApiKey(`${key.slice(0, -1)}c`))
  })
})

describe.skipIf(!live)('api keys (DARVIN_DB=1)', () => {
  const created: string[] = []

  async function newAccount(): Promise<UserViewer> {
    // The provider's subject is what identity is keyed on; the app id comes back.
    const id = await ensureUser({ subject: randomUUID(), email: `keys-${randomUUID()}@example.test` })
    created.push(id)
    return { kind: 'user', userId: id }
  }

  afterAll(async () => {
    if (created.length === 0) return
    // api_keys cascades from users, but deleting explicitly keeps the suite
    // honest if that constraint ever changes.
    await db.delete(apiKeys).where(inArray(apiKeys.userId, created))
    await db.delete(subscriptions).where(inArray(subscriptions.userId, created))
    await db.delete(memberships).where(inArray(memberships.userId, created))
    await db.delete(organizations).where(inArray(organizations.ownerId, created))
    await db.delete(users).where(inArray(users.id, created))
  })

  describe('createApiKey', () => {
    it('returns the plaintext once and stores only its hash', async () => {
      const viewer = await newAccount()
      const result = await createApiKey(viewer, 'CI', 10)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const { plaintext, key } = result.created
      expect(looksLikeApiKey(plaintext)).toBe(true)

      const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, key.id))
      expect(row).toBeDefined()
      // The whole guarantee: nothing in the row reproduces the secret.
      expect(row!.keyHash).toBe(hashApiKey(plaintext))
      expect(JSON.stringify(row)).not.toContain(plaintext)
    })

    it('stores a prefix that is a real slice of the key, and nothing more', async () => {
      const viewer = await newAccount()
      const result = await createApiKey(viewer, 'laptop', 10)
      if (!result.ok) throw new Error('expected a key')

      const { plaintext, key } = result.created
      expect(key.prefix).not.toBeNull()
      expect(plaintext.startsWith(key.prefix!)).toBe(true)
      // Short enough that what it reveals is not worth having.
      expect(key.prefix!.length).toBeLessThan(plaintext.length / 4)
    })

    it('mints a different key every time', async () => {
      const viewer = await newAccount()
      const a = await createApiKey(viewer, 'a', 10)
      const b = await createApiKey(viewer, 'b', 10)
      if (!a.ok || !b.ok) throw new Error('expected two keys')
      expect(a.created.plaintext).not.toBe(b.created.plaintext)
    })

    it('enforces the ceiling at the write', async () => {
      const viewer = await newAccount()
      expect((await createApiKey(viewer, 'one', 2)).ok).toBe(true)
      expect((await createApiKey(viewer, 'two', 2)).ok).toBe(true)
      expect(await createApiKey(viewer, 'three', 2)).toEqual({ ok: false, reason: 'limit-reached' })
    })

    it('treats a ceiling of zero as "no API access", not as "unlimited"', async () => {
      const viewer = await newAccount()
      expect(await createApiKey(viewer, 'free-tier', 0)).toEqual({ ok: false, reason: 'limit-reached' })
      expect(await listApiKeys(viewer)).toHaveLength(0)
    })

    it('refuses an anonymous caller', async () => {
      expect(await createApiKey(ANONYMOUS, 'nobody', 10)).toEqual({
        ok: false,
        reason: 'unauthenticated',
      })
    })
  })

  describe('listApiKeys', () => {
    it('returns only the caller’s keys, and never a hash', async () => {
      const mine = await newAccount()
      const theirs = await newAccount()
      await createApiKey(mine, 'mine', 10)
      await createApiKey(theirs, 'theirs', 10)

      const listed = await listApiKeys(mine)
      expect(listed).toHaveLength(1)
      expect(listed[0]!.name).toBe('mine')
      expect(JSON.stringify(listed)).not.toContain('keyHash')
    })

    it('returns nothing for an anonymous caller', async () => {
      expect(await listApiKeys(ANONYMOUS)).toEqual([])
    })
  })

  describe('resolveApiKey', () => {
    it('maps a key back to the account that owns it', async () => {
      const viewer = await newAccount()
      const result = await createApiKey(viewer, 'CI', 10)
      if (!result.ok) throw new Error('expected a key')

      const resolved = await resolveApiKey(result.created.plaintext)
      expect(resolved).toEqual({ userId: viewer.userId, keyId: result.created.key.id })
    })

    it('records that the key was used', async () => {
      const viewer = await newAccount()
      const result = await createApiKey(viewer, 'CI', 10)
      if (!result.ok) throw new Error('expected a key')
      expect(result.created.key.lastUsedAt).toBeNull()

      await resolveApiKey(result.created.plaintext)

      const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, result.created.key.id))
      expect(row!.lastUsedAt).toBeInstanceOf(Date)
    })

    it('does not re-write lastUsedAt on every call', async () => {
      const viewer = await newAccount()
      const result = await createApiKey(viewer, 'CI', 10)
      if (!result.ok) throw new Error('expected a key')

      await resolveApiKey(result.created.plaintext)
      const [first] = await db.select().from(apiKeys).where(eq(apiKeys.id, result.created.key.id))

      await resolveApiKey(result.created.plaintext)
      const [second] = await db.select().from(apiKeys).where(eq(apiKeys.id, result.created.key.id))

      // A busy key would otherwise serialise on an UPDATE to its own row for
      // every request the API serves.
      expect(second!.lastUsedAt!.getTime()).toBe(first!.lastUsedAt!.getTime())
    })

    it('refuses anything that is not a live key', async () => {
      const viewer = await newAccount()
      const result = await createApiKey(viewer, 'CI', 10)
      if (!result.ok) throw new Error('expected a key')
      const good = result.created.plaintext

      expect(await resolveApiKey('')).toBeNull()
      expect(await resolveApiKey('Bearer')).toBeNull()
      expect(await resolveApiKey(`dv_${'0'.repeat(64)}`)).toBeNull() // well-formed, unknown
      expect(await resolveApiKey(good.slice(0, -1))).toBeNull() // truncated
      expect(await resolveApiKey(good.toUpperCase())).toBeNull() // case-mangled
      // A near miss: same key, last character changed. Nothing about the
      // response may reveal how close it came.
      expect(await resolveApiKey(`${good.slice(0, -1)}${good.endsWith('a') ? 'b' : 'a'}`)).toBeNull()
    })
  })

  describe('revokeApiKey', () => {
    it('stops the key authenticating, immediately', async () => {
      const viewer = await newAccount()
      const result = await createApiKey(viewer, 'leaked', 10)
      if (!result.ok) throw new Error('expected a key')

      expect(await resolveApiKey(result.created.plaintext)).not.toBeNull()
      expect(await revokeApiKey(result.created.key.id, viewer)).toBe(true)
      expect(await resolveApiKey(result.created.plaintext)).toBeNull()
    })

    it('frees a slot under the ceiling', async () => {
      const viewer = await newAccount()
      const first = await createApiKey(viewer, 'one', 1)
      if (!first.ok) throw new Error('expected a key')
      expect((await createApiKey(viewer, 'two', 1)).ok).toBe(false)

      await revokeApiKey(first.created.key.id, viewer)
      expect((await createApiKey(viewer, 'two', 1)).ok).toBe(true)
    })

    it('refuses another account’s key and leaves no trace', async () => {
      const mine = await newAccount()
      const theirs = await newAccount()
      const victim = await createApiKey(theirs, 'theirs', 10)
      if (!victim.ok) throw new Error('expected a key')

      // Same answer as "no such key" — an attacker must not learn that an id
      // exists but belongs to someone else.
      expect(await revokeApiKey(victim.created.key.id, mine)).toBe(false)
      expect(await revokeApiKey(randomUUID(), mine)).toBe(false)

      // And it still works, because nothing about it changed.
      expect(await resolveApiKey(victim.created.plaintext)).not.toBeNull()
      expect(await listApiKeys(theirs)).toHaveLength(1)
    })

    it('refuses an anonymous caller', async () => {
      const viewer = await newAccount()
      const result = await createApiKey(viewer, 'CI', 10)
      if (!result.ok) throw new Error('expected a key')

      expect(await revokeApiKey(result.created.key.id, ANONYMOUS)).toBe(false)
      expect(await resolveApiKey(result.created.plaintext)).not.toBeNull()
    })
  })
})
