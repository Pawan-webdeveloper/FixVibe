/**
 * Plan limits — against a real Postgres.
 *
 *   DARVIN_DB=1 pnpm --filter @darvin/db test
 *
 * These two functions are the difference between a price list and a plan.
 * `createProject` refuses at the WRITE rather than in a server action, because
 * the action is not the only caller — the public API will create projects too,
 * and a rule enforced in one caller is a rule the next caller forgets.
 *
 * `countScansForUserSince` is the monthly allowance, and the thing worth
 * pinning is what it does NOT count: an anonymous scan has no account to
 * charge, and another account's scans are not this one's problem.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { db } from '../src/client.ts'
import { memberships, organizations, projects, scans, subscriptions, users } from '../src/schema.ts'
import { ensureUser, getUserContext } from '../src/queries/users.ts'
import { createProject } from '../src/queries/projects.ts'
import { countScansForUserSince, createScan } from '../src/queries/scans.ts'
import { ANONYMOUS, type Viewer } from '../src/queries/viewer.ts'

const live = process.env.DARVIN_DB === '1'

describe.skipIf(!live)('plan limits (DARVIN_DB=1)', () => {
  const created: string[] = []
  const scanIds: string[] = []

  async function newAccount(): Promise<{ viewer: Viewer & { kind: 'user' }; orgId: string }> {
    const id = randomUUID()
    await ensureUser({ id, email: `limits-${id}@example.test` })
    created.push(id)
    const context = await getUserContext(id)
    return { viewer: { kind: 'user', userId: id }, orgId: context!.orgId }
  }

  async function scanFor(userId: string | null): Promise<void> {
    const { id } = await createScan({
      url: 'https://limits.test/',
      profile: 'fast',
      engineVersion: '0.0.0-test',
      checksRun: 1,
      requestedBy: userId,
    })
    scanIds.push(id)
  }

  afterAll(async () => {
    if (scanIds.length > 0) await db.delete(scans).where(inArray(scans.id, scanIds))
    if (created.length === 0) return
    await db.delete(projects).where(inArray(projects.ownerId, created))
    await db.delete(subscriptions).where(inArray(subscriptions.userId, created))
    await db.delete(memberships).where(inArray(memberships.userId, created))
    await db.delete(organizations).where(inArray(organizations.ownerId, created))
    await db.delete(users).where(inArray(users.id, created))
  })

  describe('createProject', () => {
    it('allows up to the ceiling and refuses the one after it', async () => {
      const { viewer, orgId } = await newAccount()

      const first = await createProject(viewer, { name: 'a', url: 'https://a.test/', orgId }, 1)
      expect(first.ok).toBe(true)

      const second = await createProject(viewer, { name: 'b', url: 'https://b.test/', orgId }, 1)
      expect(second).toEqual({ ok: false, reason: 'limit-reached' })
    })

    it('counts only this account’s projects towards its ceiling', async () => {
      const a = await newAccount()
      const b = await newAccount()

      expect((await createProject(a.viewer, { name: 'a', url: 'https://a.test/', orgId: a.orgId }, 1)).ok).toBe(true)
      // b has used none of its own, however many a has.
      expect((await createProject(b.viewer, { name: 'b', url: 'https://b.test/', orgId: b.orgId }, 1)).ok).toBe(true)
    })

    it('refuses an anonymous caller before it counts anything', async () => {
      const { orgId } = await newAccount()
      const result = await createProject(ANONYMOUS, { name: 'x', url: 'https://x.test/', orgId }, 100)
      expect(result).toEqual({ ok: false, reason: 'unauthenticated' })
    })
  })

  describe('countScansForUserSince', () => {
    const since = new Date(Date.now() - 86_400_000)

    it('counts the account’s own scans', async () => {
      const { viewer } = await newAccount()
      await scanFor(viewer.userId)
      await scanFor(viewer.userId)

      expect(await countScansForUserSince(viewer.userId, since)).toBe(2)
    })

    it('never counts an anonymous scan — there is no account to charge', async () => {
      const { viewer } = await newAccount()
      await scanFor(null)
      await scanFor(null)

      expect(await countScansForUserSince(viewer.userId, since)).toBe(0)
    })

    it('never counts another account’s scans', async () => {
      const a = await newAccount()
      const b = await newAccount()
      await scanFor(a.viewer.userId)

      expect(await countScansForUserSince(b.viewer.userId, since)).toBe(0)
    })

    it('ignores scans older than the window, so the allowance actually resets', async () => {
      const { viewer } = await newAccount()
      await scanFor(viewer.userId)

      const tomorrow = new Date(Date.now() + 86_400_000)
      expect(await countScansForUserSince(viewer.userId, tomorrow)).toBe(0)
    })
  })
})
