/**
 * Who an alert reaches — against a real Postgres.
 *
 *   SCANLYFIX_DB=1 pnpm --filter @scanlyfix/db test
 *
 * This query joins alerts to projects to users, and the join is the whole
 * risk: get it wrong and a customer is told about somebody else's site, or
 * told nothing at all. `sentAt` is the other thing worth pinning — it is the
 * only record that an alert was raised and never delivered, so it must stay
 * null until a provider has actually accepted the message.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { db } from '../src/client.ts'
import { alerts, memberships, organizations, projects, subscriptions, users } from '../src/schema.ts'
import { ensureUser, getUserContext } from '../src/queries/users.ts'
import { createProject } from '../src/queries/projects.ts'
import { alertForDelivery, markAlertSent, recordAlertOnce } from '../src/queries/alerts.ts'
import type { Viewer } from '../src/queries/viewer.ts'

const live = process.env.SCANLYFIX_DB === '1'

describe.skipIf(!live)('alert delivery lookup (SCANLYFIX_DB=1)', () => {
  const created: string[] = []

  async function newProject(label: string) {
    const email = `alerts-${randomUUID()}@example.test`
    const id = await ensureUser({ subject: randomUUID(), email })
    created.push(id)

    const viewer: Viewer = { kind: 'user', userId: id }
    const context = await getUserContext(id)
    const result = await createProject(
      viewer,
      { name: label, url: `https://${label}.test/`, orgId: context!.orgId },
      100,
    )
    if (!result.ok) throw new Error('could not create the fixture project')
    return { project: result.project, email }
  }

  afterAll(async () => {
    if (created.length === 0) return
    await db.delete(projects).where(inArray(projects.ownerId, created))
    await db.delete(subscriptions).where(inArray(subscriptions.userId, created))
    await db.delete(memberships).where(inArray(memberships.userId, created))
    await db.delete(organizations).where(inArray(organizations.ownerId, created))
    await db.delete(users).where(inArray(users.id, created))
  })

  it('resolves the project owner as the recipient', async () => {
    const { project, email } = await newProject('recipient')
    const alert = await recordAlertOnce({
      projectId: project.id,
      kind: 'downtime',
      channel: 'email',
      payload: { streak: 3 },
    })

    const found = await alertForDelivery(alert!.id)
    expect(found?.recipientEmail).toBe(email)
    expect(found?.projectName).toBe('recipient')
    expect(found?.projectUrl).toBe('https://recipient.test/')
    expect(found?.projectSlug).toBe(project.slug)
  })

  it('carries the kind and payload through, since delivery renders from them', async () => {
    const { project } = await newProject('payload')
    const alert = await recordAlertOnce({
      projectId: project.id,
      kind: 'certificate-expiry-7',
      channel: 'email',
      payload: { daysLeft: 7, expired: false },
    })

    const found = await alertForDelivery(alert!.id)
    expect(found?.kind).toBe('certificate-expiry-7')
    expect(found?.payload).toEqual({ daysLeft: 7, expired: false })
  })

  it('never crosses accounts — one owner’s alert resolves to one owner', async () => {
    const a = await newProject('owner-a')
    const b = await newProject('owner-b')

    const alertA = await recordAlertOnce({
      projectId: a.project.id, kind: 'downtime', channel: 'email', payload: {},
    })
    const alertB = await recordAlertOnce({
      projectId: b.project.id, kind: 'downtime', channel: 'email', payload: {},
    })

    expect((await alertForDelivery(alertA!.id))?.recipientEmail).toBe(a.email)
    expect((await alertForDelivery(alertB!.id))?.recipientEmail).toBe(b.email)
  })

  it('starts unsent — a raised alert is not a delivered one', async () => {
    const { project } = await newProject('unsent')
    const alert = await recordAlertOnce({
      projectId: project.id, kind: 'downtime', channel: 'email', payload: {},
    })

    expect((await alertForDelivery(alert!.id))?.sentAt).toBeNull()
  })

  it('records delivery only when it is marked, and the mark is visible', async () => {
    const { project } = await newProject('marked')
    const alert = await recordAlertOnce({
      projectId: project.id, kind: 'downtime', channel: 'email', payload: {},
    })

    await markAlertSent(alert!.id)
    expect((await alertForDelivery(alert!.id))?.sentAt).toBeInstanceOf(Date)
  })

  it('returns null for an id that is not an alert', async () => {
    expect(await alertForDelivery(randomUUID())).toBeNull()
  })
})
