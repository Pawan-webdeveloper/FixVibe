/**
 * The whole point of Phase 10, proved end to end.
 *
 *   DARVIN_DB=1 pnpm --filter @darvin/db test
 *
 * Verification is only worth anything if it actually reaches the engine, and
 * the chain has four links: mark verified → verifiedHostForProject returns a
 * host → buildContext is given it → activeProbe exists on the context. A break
 * anywhere in that leaves a project the customer verified and two checks that
 * still never run, with nothing on screen to say so.
 *
 * The rule itself — that the gate compares where the scan LANDED rather than
 * what was submitted, so a verified domain redirecting to a stranger cannot
 * smuggle the capability onto it — is already pinned in the engine's own
 * active-testing-gate.test.ts. It is not repeated here, and mayTestActively is
 * deliberately left off the package's public surface rather than widened to
 * suit a test.
 *
 * This makes ONE real request, to example.com, which is IANA's reserved
 * demonstration domain. The assertion is about the CAPABILITY being granted,
 * not about what a probe would find — example.com has no Supabase project to
 * ask, and this test would be worse if it depended on somebody's backend.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { buildContext } from '@darvin/checks'
import { db } from '../src/client.ts'
import { memberships, organizations, projects, subscriptions, users } from '../src/schema.ts'
import { ensureUser, getUserContext } from '../src/queries/users.ts'
import {
  createProject,
  markDomainVerified,
  revokeDomainVerification,
  verifiedHostForProject,
} from '../src/queries/projects.ts'
import type { Viewer } from '../src/queries/viewer.ts'

const live = process.env.DARVIN_DB === '1'

describe.skipIf(!live)('verification reaches the engine (DARVIN_DB=1)', () => {
  const created: string[] = []

  afterAll(async () => {
    if (created.length === 0) return
    await db.delete(projects).where(inArray(projects.ownerId, created))
    await db.delete(subscriptions).where(inArray(subscriptions.userId, created))
    await db.delete(memberships).where(inArray(memberships.userId, created))
    await db.delete(organizations).where(inArray(organizations.ownerId, created))
    await db.delete(users).where(inArray(users.id, created))
  })

  it('grants activeProbe only after the domain is verified', { timeout: 60_000 }, async () => {
    const id = randomUUID()
    await ensureUser({ id, email: `chain-${id}@example.test` })
    created.push(id)

    const viewer: Viewer = { kind: 'user', userId: id }
    const context = await getUserContext(id)
    const result = await createProject(
      viewer,
      { name: 'chain', url: 'https://example.com/', orgId: context!.orgId },
      100,
    )
    if (!result.ok) throw new Error('fixture project failed')
    const projectId = result.project.id

    /* ---- unverified: no host, and therefore no capability ---------------- */
    expect(await verifiedHostForProject(projectId)).toBeNull()

    const before = await buildContext('https://example.com/', {})
    expect(before.activeProbe).toBeUndefined()

    /* ---- verified: a host, and the capability the checks require ---------- */
    await markDomainVerified(projectId, viewer)
    const verifiedHost = await verifiedHostForProject(projectId)
    expect(verifiedHost).toBe('example.com')

    const after = await buildContext('https://example.com/', {
      activeTesting: { verifiedHost: verifiedHost! },
    })
    expect(typeof after.activeProbe).toBe('function')

    /* ---- revoked: back to nothing ---------------------------------------- */
    await revokeDomainVerification(projectId, viewer)
    expect(await verifiedHostForProject(projectId)).toBeNull()
  })

})
