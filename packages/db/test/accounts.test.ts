/**
 * Accounts, projects, and the claim funnel — against a real Postgres.
 *
 *   SCANLYFIX_DB=1 pnpm --filter @scanlyfix/db test
 *
 * Weighted toward two things. First, authorization: like queries/scans.ts these
 * functions are the only barrier between one account and another's data,
 * because Drizzle connects as the database owner and RLS never applies.
 * Second, the delta rule — a score comparison must refuse to produce a number
 * when the two scans were not measured the same way, or monitoring alerts on
 * our own deploys.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import type { ScanScores } from '@scanlyfix/checks'
import { db } from '../src/client.ts'
import { memberships, organizations, projects, scans, subscriptions, users } from '../src/schema.ts'
import { ensureUser, getUserContext, userIdForAuthSubject } from '../src/queries/users.ts'
import {
  verifiedHostForProject,
  claimScan,
  createProject,
  getProject,
  listProjectSummaries,
  listProjects,
  listScansForProject,
} from '../src/queries/projects.ts'
import { completeScan, createScan } from '../src/queries/scans.ts'
import { ANONYMOUS, type Viewer } from '../src/queries/viewer.ts'

/**
 * createProject now takes the plan's project ceiling. These tests are about
 * ownership and history rather than pricing, so they pass a ceiling nothing
 * here reaches; the limit itself has its own file.
 */
async function makeProject(
  viewer: Viewer,
  input: { name: string; url: string; orgId: string },
): Promise<Project | null> {
  const result = await createProject(viewer, input, 100)
  return result.ok ? result.project : null
}

const live = process.env.SCANLYFIX_DB === '1'

const scores = (overall: number, degraded: ScanScores['degraded'] = []): ScanScores => ({
  security: overall, seo: overall, aeo: 100, performance: 100,
  accessibility: 100, compliance: 100, overall, degraded,
})

const META = { finalUrl: 'https://x.test/', redirectChain: [], status: 200, framework: null, tlsExpiry: null }

describe.skipIf(!live)('accounts and projects (SCANLYFIX_DB=1)', () => {
  const createdUsers: string[] = []
  /**
   * Anonymous scans have no project and no requester, so deleting the test
   * users does NOT cascade to them — they outlive the suite and accumulate.
   * Tracked separately for that reason.
   */
  const createdScans: string[] = []

  const newIdentity = () => {
    const subject = randomUUID()
    return { subject, email: `u-${subject}@example.test` }
  }

  /**
   * ensureUser returns the APPLICATION's user id, which is not the provider's
   * subject — see users.authSubject. Cleanup tracks the app id, so it can only
   * be recorded after the row exists.
   */
  const createAccount = async () => {
    const identity = newIdentity()
    const id = await ensureUser(identity)
    createdUsers.push(id)
    return { ...identity, id }
  }

  afterAll(async () => {
    if (createdScans.length) await db.delete(scans).where(inArray(scans.id, createdScans))
    if (createdUsers.length) await db.delete(users).where(inArray(users.id, createdUsers))
  })

  describe('ensureUser', () => {
    it('creates the user, a personal org, an owner membership and a free subscription', async () => {
      const identity = await createAccount()

      const context = await getUserContext(identity.id)
      expect(context?.email).toBe(identity.email)
      expect(context?.plan).toBe('free')
      expect(context?.orgId).toBeTruthy()

      const membership = await db.query.memberships.findFirst({
        where: eq(memberships.userId, identity.id),
      })
      expect(membership?.role).toBe('owner')
    })

    it('is idempotent — it runs on every sign-in, not just the first', async () => {
      const identity = await createAccount()
      await ensureUser(identity)
      await ensureUser(identity)
      // Three sign-ins, one org and one subscription.

      const orgs = await db.query.organizations.findMany({ where: eq(organizations.ownerId, identity.id) })
      const subs = await db.query.subscriptions.findMany({ where: eq(subscriptions.userId, identity.id) })
      expect(orgs).toHaveLength(1)
      expect(subs).toHaveLength(1)
    })

    it('updates the email when it changes upstream, keyed on the immutable subject', async () => {
      const identity = await createAccount()
      const again = await ensureUser({ subject: identity.subject, email: `changed-${identity.subject}@example.test` })

      // Same row, not a second one: the subject is the conflict target, so a
      // changed address updates the account rather than forking it.
      expect(again).toBe(identity.id)
      expect((await getUserContext(identity.id))?.email).toContain('changed-')
    })

    it('adopts a new subject for a known address, keeping one account', async () => {
      /*
       * The same person, proven again by a provider that now names them
       * differently — a new Convex deployment renumbering every subject, or
       * Google after GitHub. Because every provider here verifies control of
       * the address before issuing a subject, a matching email is proof of the
       * same person, so the account follows the address rather than forking or
       * throwing. Throwing was the "could not create the account row" failure
       * that locked returning users out after the deployment moved.
       */
      const shared = `shared-${randomUUID()}@example.test`
      const firstSubject = randomUUID()
      const secondSubject = randomUUID()

      const first = await ensureUser({ subject: firstSubject, email: shared })
      createdUsers.push(first)

      const second = await ensureUser({ subject: secondSubject, email: shared })

      // One account, not two, and not an error.
      expect(second).toBe(first)
      // The new subject now resolves to it; the old one no longer does.
      expect(await userIdForAuthSubject(secondSubject)).toBe(first)
      expect(await userIdForAuthSubject(firstSubject)).toBeNull()
    })

    it('returns null for a user that was never created', async () => {
      expect(await getUserContext(randomUUID())).toBeNull()
    })
  })

  describe('project ownership', () => {
    it('refuses every read to an anonymous viewer', async () => {
      const identity = await createAccount()
      const viewer: Viewer = { kind: 'user', userId: identity.id }
      const context = await getUserContext(identity.id)
      const project = await makeProject(viewer, { name: 'x', url: 'https://x.test/', orgId: context!.orgId })

      expect(await listProjects(ANONYMOUS)).toEqual([])
      expect(await getProject(project!.id, ANONYMOUS)).toBeNull()
      expect(await listScansForProject(project!.id, ANONYMOUS)).toEqual([])
      expect(await makeProject(ANONYMOUS, { name: 'x', url: 'https://x.test/', orgId: context!.orgId })).toBeNull()
    })

    it('hides one account\'s project from another', async () => {
      // The test that matters. If this passes, every customer's projects are
      // readable by anyone who can guess a UUID.
      const owner = await createAccount()
      const stranger = await createAccount()
      const ownerCtx = await getUserContext(owner.id)
      const project = await makeProject(
        { kind: 'user', userId: owner.id },
        { name: 'x', url: 'https://x.test/', orgId: ownerCtx!.orgId },
      )

      expect(await getProject(project!.id, { kind: 'user', userId: stranger.id })).toBeNull()
      expect(await listProjects({ kind: 'user', userId: stranger.id })).toEqual([])
      expect(await listScansForProject(project!.id, { kind: 'user', userId: stranger.id })).toEqual([])
    })

    it('gives each project a slug that is not its uuid', async () => {
      const identity = await createAccount()
      const context = await getUserContext(identity.id)
      const project = await makeProject(
        { kind: 'user', userId: identity.id },
        { name: 'x', url: 'https://Example.TEST/path', orgId: context!.orgId },
      )
      expect(project!.slug).toMatch(/^example-test-[0-9a-f]{8}$/)
      expect(project!.slug).not.toBe(project!.id)
    })
  })

  describe('claimScan — the signup funnel', () => {
    const openAnonymousScan = async (url = `https://claim-${randomUUID()}.test/`) => {
      const { id } = await createScan({ url, profile: 'fast', engineVersion: '0.0.0-test', checksRun: 1 })
      createdScans.push(id)
      return id
    }

    it('turns an anonymous scan into a project the viewer owns', async () => {
      const identity = await createAccount()
      const context = await getUserContext(identity.id)
      const scanId = await openAnonymousScan()

      const claimed = await claimScan(scanId, { kind: 'user', userId: identity.id }, context!.orgId)
      expect(claimed).not.toBeNull()

      const scan = await db.query.scans.findFirst({ where: eq(scans.id, scanId) })
      expect(scan?.projectId).toBe(claimed!.projectId)
      expect(scan?.requestedBy).toBe(identity.id)
    })

    it('refuses a scan that somebody already claimed', async () => {
      const first = await createAccount()
      const second = await createAccount()
      const scanId = await openAnonymousScan()

      await claimScan(scanId, { kind: 'user', userId: first.id }, (await getUserContext(first.id))!.orgId)
      const again = await claimScan(scanId, { kind: 'user', userId: second.id }, (await getUserContext(second.id))!.orgId)
      expect(again).toBeNull()
    })

    it('leaves no orphan project behind when the claim loses', async () => {
      const first = await createAccount()
      const second = await createAccount()
      const scanId = await openAnonymousScan()

      await claimScan(scanId, { kind: 'user', userId: first.id }, (await getUserContext(first.id))!.orgId)
      await claimScan(scanId, { kind: 'user', userId: second.id }, (await getUserContext(second.id))!.orgId)

      expect(await db.query.projects.findMany({ where: eq(projects.ownerId, second.id) })).toEqual([])
    })

    it('refuses an anonymous viewer and an unknown scan', async () => {
      const identity = await createAccount()
      const orgId = (await getUserContext(identity.id))!.orgId
      expect(await claimScan(await openAnonymousScan(), ANONYMOUS, orgId)).toBeNull()
      expect(await claimScan(randomUUID(), { kind: 'user', userId: identity.id }, orgId)).toBeNull()
    })
  })

  describe('score delta', () => {
    const setup = async () => {
      const identity = await createAccount()
      const context = await getUserContext(identity.id)
      const viewer: Viewer = { kind: 'user', userId: identity.id }
      const project = await makeProject(viewer, { name: 'd', url: 'https://d.test/', orgId: context!.orgId })
      return { viewer, projectId: project!.id }
    }

    const addScan = async (
      projectId: string,
      overall: number,
      opts: { engineVersion?: string; profile?: 'fast' | 'deep'; degraded?: ScanScores['degraded'] } = {},
    ) => {
      const { id } = await createScan({
        url: 'https://d.test/',
        profile: opts.profile ?? 'fast',
        engineVersion: opts.engineVersion ?? '1.0.0',
        checksRun: 29,
        projectId,
      })
      await completeScan(id, {
        scores: scores(overall, opts.degraded ?? []),
        findings: [], contextMeta: META, checkErrors: [], durationMs: 1,
      })
      return id
    }

    it('reports the difference when both scans were measured the same way', async () => {
      const { viewer, projectId } = await setup()
      await addScan(projectId, 60)
      await addScan(projectId, 75)
      const [summary] = await listProjectSummaries(viewer)
      expect(summary?.delta).toBe(15)
    })

    it('refuses a number when the engine version changed — that is our deploy, not their site', async () => {
      const { viewer, projectId } = await setup()
      await addScan(projectId, 80, { engineVersion: '1.0.0' })
      await addScan(projectId, 60, { engineVersion: '1.1.0' })
      const [summary] = await listProjectSummaries(viewer)
      expect(summary?.delta).toBeNull()
    })

    it('refuses a number across scan depths', async () => {
      const { viewer, projectId } = await setup()
      await addScan(projectId, 80, { profile: 'fast' })
      await addScan(projectId, 60, { profile: 'deep' })
      expect((await listProjectSummaries(viewer))[0]?.delta).toBeNull()
    })

    it('refuses a number when either scan had a pillar it could not fully measure', async () => {
      const { viewer, projectId } = await setup()
      await addScan(projectId, 80)
      await addScan(projectId, 90, { degraded: ['security'] })
      expect((await listProjectSummaries(viewer))[0]?.delta).toBeNull()
    })

    it('has no delta with only one scan', async () => {
      const { viewer, projectId } = await setup()
      await addScan(projectId, 70)
      const [summary] = await listProjectSummaries(viewer)
      expect(summary?.latest).not.toBeNull()
      expect(summary?.delta).toBeNull()
    })
  })
  /**
   * The gate on active backend testing.
   *
   * This layer answers only "which host did they prove they own" — the
   * comparison against the page we actually landed on happens in
   * buildContext, because a redirect otherwise walks straight through a
   * decision made before the fetch.
   */
  describe('verifiedHostForProject', () => {
    const projectWith = async (url: string, verified: boolean) => {
      const identity = await createAccount()
      const context = await getUserContext(identity.id)
      const project = await makeProject({ kind: 'user', userId: identity.id }, { name: 'p', url, orgId: context!.orgId })
      if (verified) await db.update(projects).set({ verifiedDomain: true }).where(eq(projects.id, project!.id))
      return project!.id
    }

    it('returns the verified host, normalised', async () => {
      expect(await verifiedHostForProject(await projectWith('https://owned.test/pricing', true))).toBe('owned.test')
      // "www." is a presentation prefix, not a different site.
      expect(await verifiedHostForProject(await projectWith('https://WWW.Owned.TEST/', true))).toBe('owned.test')
    })

    it('returns null for a project that has not proved ownership', async () => {
      expect(await verifiedHostForProject(await projectWith('https://unverified.test/', false))).toBeNull()
    })

    it('returns null for anonymous scans and unknown projects', async () => {
      expect(await verifiedHostForProject(null)).toBeNull()
      expect(await verifiedHostForProject(undefined)).toBeNull()
      expect(await verifiedHostForProject(randomUUID())).toBeNull()
    })

    it('returns null when the stored project URL does not parse', async () => {
      const projectId = await projectWith('https://owned.test/', true)
      await db.update(projects).set({ url: 'not a url' }).where(eq(projects.id, projectId))
      expect(await verifiedHostForProject(projectId)).toBeNull()
    })
  })
})
