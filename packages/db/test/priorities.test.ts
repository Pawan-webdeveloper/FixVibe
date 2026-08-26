/**
 * Onboarding priorities — against a real Postgres.
 *
 *   DARVIN_DB=1 pnpm --filter @darvin/db test
 *
 * Two things are worth a test here and neither is the happy path.
 *
 * NULL and [] must stay distinguishable. Null is "never asked" and is the only
 * thing that sends somebody through /welcome; an empty answer is a real answer.
 * Collapsing them is how a user gets asked the same question on every sign-in.
 *
 * And setUserPriorities must write the caller's own row and no other. It takes
 * a Viewer rather than a user id precisely so there is no target parameter to
 * point somewhere else, and that has to be true at runtime, not just in the
 * type.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { db } from '../src/client.ts'
import { memberships, organizations, subscriptions, users } from '../src/schema.ts'
import { ensureUser, getUserContext, setUserPriorities } from '../src/queries/users.ts'
import { ANONYMOUS, type Viewer } from '../src/queries/viewer.ts'

const live = process.env.DARVIN_DB === '1'

describe.skipIf(!live)('user priorities (DARVIN_DB=1)', () => {
  const created: string[] = []

  async function newUser(): Promise<Viewer & { kind: 'user' }> {
    const id = randomUUID()
    await ensureUser({ id, email: `priorities-${id}@example.test` })
    created.push(id)
    return { kind: 'user', userId: id }
  }

  afterAll(async () => {
    if (created.length === 0) return
    await db.delete(subscriptions).where(inArray(subscriptions.userId, created))
    await db.delete(memberships).where(inArray(memberships.userId, created))
    await db.delete(organizations).where(inArray(organizations.ownerId, created))
    await db.delete(users).where(inArray(users.id, created))
  })

  it('starts null, so a new account is asked exactly once', async () => {
    const viewer = await newUser()
    expect((await getUserContext(viewer.userId))?.priorities).toBeNull()
  })

  it('stores an empty answer as [] rather than leaving it null', async () => {
    const viewer = await newUser()
    await setUserPriorities(viewer, [])

    const priorities = (await getUserContext(viewer.userId))?.priorities
    expect(priorities).toEqual([])
    // The distinction the /welcome redirect is built on.
    expect(priorities).not.toBeNull()
  })

  it('round-trips the chosen pillars', async () => {
    const viewer = await newUser()
    await setUserPriorities(viewer, ['security', 'aeo'])

    expect((await getUserContext(viewer.userId))?.priorities).toEqual(['security', 'aeo'])
  })

  it('de-duplicates, so a repeated pillar cannot skew anything built on length', async () => {
    const viewer = await newUser()
    await setUserPriorities(viewer, ['seo', 'seo', 'security', 'seo'])

    expect((await getUserContext(viewer.userId))?.priorities).toEqual(['seo', 'security'])
  })

  it('replaces rather than appends, so the screen can be used to change them', async () => {
    const viewer = await newUser()
    await setUserPriorities(viewer, ['security', 'seo', 'performance'])
    await setUserPriorities(viewer, ['compliance'])

    expect((await getUserContext(viewer.userId))?.priorities).toEqual(['compliance'])
  })

  it('writes nothing for an anonymous caller', async () => {
    const viewer = await newUser()
    await setUserPriorities(viewer, ['security'])

    await setUserPriorities(ANONYMOUS, ['seo', 'compliance'])

    // The anonymous call is a no-op, not a write aimed at the last user seen.
    expect((await getUserContext(viewer.userId))?.priorities).toEqual(['security'])
  })
})
