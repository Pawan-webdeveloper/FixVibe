/**
 * The scan query layer, against a real Postgres.
 *
 * These need a live database, so they run only when asked:
 *
 *   DARVIN_DB=1 pnpm --filter @darvin/db test
 *
 * Most of what follows is about getScanForViewer, because this module is the
 * ONLY thing standing between one account's scans and another's. Drizzle
 * connects as the database owner, so Postgres row-level security is bypassed
 * — there is no second layer to catch a mistake here.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import type { Finding, ScanScores } from '@darvin/checks'
import { db } from '../src/client.ts'
import { organizations, projects, scans, users, type ScanContextMeta } from '../src/schema.ts'
import { completeScan, createScan, failScan, getScanForViewer } from '../src/queries/scans.ts'
import { ANONYMOUS, type Viewer } from '../src/queries/viewer.ts'

const live = process.env.DARVIN_DB === '1'

const SCORES: ScanScores = {
  security: 70, seo: 100, aeo: 100, performance: 100,
  accessibility: 100, compliance: 100, overall: 85, degraded: [],
}

const META: ScanContextMeta = {
  finalUrl: 'https://example.test/',
  redirectChain: [],
  status: 200,
  framework: null,
  tlsExpiry: null,
}

const finding = (checkId: string): Finding => ({
  checkId,
  category: 'security',
  severity: 'high',
  title: `synthetic ${checkId}`,
  description: 'synthetic',
  evidence: { header: 'synthetic' },
  remediation: 'synthetic',
  fixPrompt: 'synthetic',
})

const open = (overrides: Partial<Parameters<typeof createScan>[0]> = {}) =>
  createScan({
    url: 'https://example.test/',
    profile: 'fast',
    engineVersion: '0.0.0-test',
    checksRun: 29,
    ...overrides,
  })

describe.skipIf(!live)('scan queries (DARVIN_DB=1)', () => {
  const createdScans: string[] = []
  let ownerId: string
  let strangerId: string
  let projectId: string

  const track = async (p: Promise<{ id: string }>) => {
    const row = await p
    createdScans.push(row.id)
    return row.id
  }

  beforeAll(async () => {
    ownerId = randomUUID()
    strangerId = randomUUID()
    await db.insert(users).values([
      { id: ownerId, email: `owner-${ownerId}@example.test` },
      { id: strangerId, email: `stranger-${strangerId}@example.test` },
    ])
    const [org] = await db
      .insert(organizations).values({ name: 'test org', ownerId }).returning({ id: organizations.id })
    const [project] = await db
      .insert(projects)
      .values({ ownerId, orgId: org!.id, name: 'test', url: 'https://example.test/', slug: `t-${randomUUID()}` })
      .returning({ id: projects.id })
    projectId = project!.id
  })

  afterAll(async () => {
    if (createdScans.length) await db.delete(scans).where(inArray(scans.id, createdScans))
    await db.delete(users).where(inArray(users.id, [ownerId, strangerId]))
  })

  it('opens a scan in the running state with its measurement identity recorded', async () => {
    const id = await track(open())
    const row = await db.query.scans.findFirst({ where: eq(scans.id, id) })
    expect(row?.status).toBe('running')
    expect(row?.startedAt).toBeInstanceOf(Date)
    expect(row?.engineVersion).toBe('0.0.0-test')
    expect(row?.checksRun).toBe(29)
    expect(row?.profile).toBe('fast')
    expect(row?.checkErrors).toEqual([])
  })

  it('stores findings and closes the scan together', async () => {
    const id = await track(open())
    await completeScan(id, {
      scores: SCORES,
      findings: [finding('security.headers.csp'), finding('security.headers.hsts')],
      contextMeta: META,
      checkErrors: [{ checkId: 'seo.sitemap', message: 'timed out' }],
      durationMs: 1234,
    })

    const scan = await getScanForViewer(id, ANONYMOUS)
    expect(scan?.status).toBe('done')
    expect(scan?.durationMs).toBe(1234)
    expect(scan?.scores).toEqual(SCORES)
    expect(scan?.contextMeta).toEqual(META)
    expect(scan?.checkErrors).toEqual([{ checkId: 'seo.sitemap', message: 'timed out' }])
    expect(scan?.findings).toHaveLength(2)
    expect(scan?.findings[0]?.evidence).toEqual({ header: 'synthetic' })
  })

  it('is idempotent, so a retried job does not duplicate every finding', async () => {
    // Inngest retries by design in Phase 5; without the delete-first this
    // silently doubles a scan's findings and halves its apparent score.
    const id = await track(open())
    const result = {
      scores: SCORES, findings: [finding('security.headers.csp')],
      contextMeta: META, checkErrors: [], durationMs: 10,
    }
    await completeScan(id, result)
    await completeScan(id, result)
    expect((await getScanForViewer(id, ANONYMOUS))?.findings).toHaveLength(1)
  })

  it('records a scan with no findings without erroring on an empty insert', async () => {
    const id = await track(open())
    await completeScan(id, { scores: SCORES, findings: [], contextMeta: META, checkErrors: [], durationMs: 5 })
    expect((await getScanForViewer(id, ANONYMOUS))?.findings).toEqual([])
  })

  it('keeps a failed scan readable, with its reason', async () => {
    const id = await track(open())
    await failScan(id, 'refused to scan a private address')
    const scan = await getScanForViewer(id, ANONYMOUS)
    expect(scan?.status).toBe('failed')
    expect(scan?.error).toContain('private address')
  })

  it('returns null for a scan id that does not exist', async () => {
    expect(await getScanForViewer(randomUUID(), ANONYMOUS)).toBeNull()
  })

  describe('who may read a scan', () => {
    it('lets anyone with the id read an anonymous scan — the link IS the capability', async () => {
      const id = await track(open())
      expect(await getScanForViewer(id, ANONYMOUS)).not.toBeNull()
      const stranger: Viewer = { kind: 'user', userId: strangerId }
      expect(await getScanForViewer(id, stranger)).not.toBeNull()
    })

    it("hides a project's scan from a logged-out visitor", async () => {
      const id = await track(open({ projectId, requestedBy: ownerId }))
      expect(await getScanForViewer(id, ANONYMOUS)).toBeNull()
    })

    it("hides a project's scan from a different account", async () => {
      // The test that matters. If this ever passes, every customer's history
      // is readable by anyone who can guess a UUID.
      const id = await track(open({ projectId, requestedBy: ownerId }))
      expect(await getScanForViewer(id, { kind: 'user', userId: strangerId })).toBeNull()
    })

    it('shows a project scan to the project owner', async () => {
      const id = await track(open({ projectId, requestedBy: ownerId }))
      expect(await getScanForViewer(id, { kind: 'user', userId: ownerId })).not.toBeNull()
    })

    it('shows a requester their own project-less scan', async () => {
      const id = await track(open({ requestedBy: ownerId }))
      expect(await getScanForViewer(id, { kind: 'user', userId: ownerId })).not.toBeNull()
      expect(await getScanForViewer(id, { kind: 'user', userId: strangerId })).toBeNull()
    })
  })
})
