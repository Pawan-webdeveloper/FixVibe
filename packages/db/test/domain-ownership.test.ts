/**
 * Domain ownership — against a real Postgres.
 *
 *   SCANLYFIX_DB=1 pnpm --filter @scanlyfix/db test
 *
 * This flag is the gate on the only two checks that send a request to somebody
 * else's backend, so the cases that matter are the ones where it must NOT be
 * set: by a stranger, for a project they do not own, or as a side effect of
 * anything other than a DNS proof that was actually read.
 *
 * The other rule with teeth is the host. verifiedHostForProject strips `www.`
 * and mayTestActively compares stripped hosts, so verification has to agree —
 * a project verified under a name the engine never asks about is verified and
 * still refused, which is the worst of both.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { db } from '../src/client.ts'
import { memberships, organizations, projects, subscriptions, users } from '../src/schema.ts'
import { ensureUser, getUserContext } from '../src/queries/users.ts'
import {
  createProject,
  ensureVerificationToken,
  markDomainVerified,
  newVerificationToken,
  revokeDomainVerification,
  verificationHost,
  verificationState,
  verifiedHostForProject,
} from '../src/queries/projects.ts'
import { ANONYMOUS, type Viewer } from '../src/queries/viewer.ts'

const live = process.env.SCANLYFIX_DB === '1'

describe('verificationHost', () => {
  it('strips www., because that is what the engine compares', () => {
    expect(verificationHost('https://www.example.com/app')).toBe('example.com')
    expect(verificationHost('https://example.com/')).toBe('example.com')
  })

  it('lowercases, since DNS is case-insensitive and comparisons are not', () => {
    expect(verificationHost('https://WWW.Example.COM/')).toBe('example.com')
  })

  it('keeps a subdomain that is not www', () => {
    expect(verificationHost('https://app.example.com/')).toBe('app.example.com')
  })

  it('answers null for something that is not a URL', () => {
    expect(verificationHost('not a url')).toBeNull()
  })
})

describe('newVerificationToken', () => {
  it('is namespaced and long enough not to be guessed', () => {
    const token = newVerificationToken()
    expect(token.startsWith('scanlyfix-verify-')).toBe(true)
    expect(token).toHaveLength('scanlyfix-verify-'.length + 64)
  })

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newVerificationToken()))
    expect(tokens.size).toBe(200)
  })
})

describe.skipIf(!live)('ownership state (SCANLYFIX_DB=1)', () => {
  const created: string[] = []

  async function newAccount() {
    const id = await ensureUser({ subject: randomUUID(), email: `verify-${randomUUID()}@example.test` })
    created.push(id)
    const context = await getUserContext(id)
    return { viewer: { kind: 'user', userId: id } as Viewer, orgId: context!.orgId }
  }

  async function newProject(url = 'https://www.owned.test/') {
    const { viewer, orgId } = await newAccount()
    const result = await createProject(viewer, { name: 'owned', url, orgId }, 100)
    if (!result.ok) throw new Error('fixture project failed')
    return { viewer, project: result.project }
  }

  afterAll(async () => {
    if (created.length === 0) return
    await db.delete(projects).where(inArray(projects.ownerId, created))
    await db.delete(subscriptions).where(inArray(subscriptions.userId, created))
    await db.delete(memberships).where(inArray(memberships.userId, created))
    await db.delete(organizations).where(inArray(organizations.ownerId, created))
    await db.delete(users).where(inArray(users.id, created))
  })

  it('mints a token at creation, so the page never writes during a render', async () => {
    const { project } = await newProject()
    expect(project.verificationToken?.startsWith('scanlyfix-verify-')).toBe(true)
  })

  it('starts unverified', async () => {
    const { viewer, project } = await newProject()
    const state = await verificationState(project.id, viewer)

    expect(state?.verified).toBe(false)
    expect(state?.verifiedAt).toBeNull()
  })

  it('reports the www-stripped host, matching what the engine will ask for', async () => {
    const { viewer, project } = await newProject('https://www.owned.test/')
    expect((await verificationState(project.id, viewer))?.host).toBe('owned.test')
  })

  it('reuses the existing token rather than invalidating a published record', async () => {
    const { viewer, project } = await newProject()
    const first = await ensureVerificationToken(project.id, viewer)
    const second = await ensureVerificationToken(project.id, viewer)

    expect(first).toBe(project.verificationToken)
    expect(second).toBe(first)
  })

  it('grants the engine a host only once verified', async () => {
    const { viewer, project } = await newProject('https://www.owned.test/')

    expect(await verifiedHostForProject(project.id)).toBeNull()
    await markDomainVerified(project.id, viewer)
    expect(await verifiedHostForProject(project.id)).toBe('owned.test')
  })

  it('records when the proof was accepted', async () => {
    const { viewer, project } = await newProject()
    await markDomainVerified(project.id, viewer)

    expect((await verificationState(project.id, viewer))?.verifiedAt).toBeInstanceOf(Date)
  })

  it('revokes the flag and the date, and keeps the token', async () => {
    const { viewer, project } = await newProject()
    await markDomainVerified(project.id, viewer)
    await revokeDomainVerification(project.id, viewer)

    const state = await verificationState(project.id, viewer)
    expect(state?.verified).toBe(false)
    expect(state?.verifiedAt).toBeNull()
    // Kept, so turning it back on does not mean republishing DNS.
    expect(state?.token).toBe(project.verificationToken)
    expect(await verifiedHostForProject(project.id)).toBeNull()
  })
})

describe.skipIf(!live)('ownership cannot be claimed by a stranger (SCANLYFIX_DB=1)', () => {
  const created: string[] = []

  async function newAccount() {
    const id = await ensureUser({ subject: randomUUID(), email: `stranger-${randomUUID()}@example.test` })
    created.push(id)
    const context = await getUserContext(id)
    return { viewer: { kind: 'user', userId: id } as Viewer, orgId: context!.orgId }
  }

  afterAll(async () => {
    if (created.length === 0) return
    await db.delete(projects).where(inArray(projects.ownerId, created))
    await db.delete(subscriptions).where(inArray(subscriptions.userId, created))
    await db.delete(memberships).where(inArray(memberships.userId, created))
    await db.delete(organizations).where(inArray(organizations.ownerId, created))
    await db.delete(users).where(inArray(users.id, created))
  })

  it('refuses every ownership call from another account', async () => {
    const owner = await newAccount()
    const stranger = await newAccount()

    const result = await createProject(
      owner.viewer,
      { name: 'theirs', url: 'https://theirs.test/', orgId: owner.orgId },
      100,
    )
    if (!result.ok) throw new Error('fixture project failed')
    const projectId = result.project.id

    expect(await verificationState(projectId, stranger.viewer)).toBeNull()
    expect(await ensureVerificationToken(projectId, stranger.viewer)).toBeNull()
    expect(await markDomainVerified(projectId, stranger.viewer)).toBe(false)
    expect(await revokeDomainVerification(projectId, stranger.viewer)).toBe(false)

    // And none of it left a mark.
    expect((await verificationState(projectId, owner.viewer))?.verified).toBe(false)
    expect(await verifiedHostForProject(projectId)).toBeNull()
  })

  it('refuses an anonymous caller', async () => {
    const owner = await newAccount()
    const result = await createProject(
      owner.viewer,
      { name: 'anon', url: 'https://anon.test/', orgId: owner.orgId },
      100,
    )
    if (!result.ok) throw new Error('fixture project failed')

    expect(await verificationState(result.project.id, ANONYMOUS)).toBeNull()
    expect(await markDomainVerified(result.project.id, ANONYMOUS)).toBe(false)
    expect(await verifiedHostForProject(result.project.id)).toBeNull()
  })
})
