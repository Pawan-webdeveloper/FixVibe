/**
 * Monitors and alert delivery, against a real Postgres.
 *
 *   DARVIN_DB=1 pnpm --filter @darvin/db test
 *
 * Weighted almost entirely toward the two rules that decide whether this is a
 * monitoring product or a nuisance: one alert per kind per day, and two
 * consecutive failures before anything is sent. Get either wrong and a flapping
 * site produces forty emails overnight — after which the customer cancels the
 * product, not the alert.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '../src/client.ts'
import { alerts, monitorEvents, monitors, users } from '../src/schema.ts'
import { ensureUser, getUserContext } from '../src/queries/users.ts'
import { createProject } from '../src/queries/projects.ts'
import type { Project } from '../src/schema.ts'
import {
  consecutiveFailures,
  dueMonitorsForScheduler,
  listMonitors,
  recordMonitorRun,
  setMonitor,
} from '../src/queries/monitors.ts'
import { listAlerts, recordAlertOnce } from '../src/queries/alerts.ts'
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

const live = process.env.DARVIN_DB === '1'

describe.skipIf(!live)('monitors and alerts (DARVIN_DB=1)', () => {
  const createdUsers: string[] = []
  let viewer: Viewer
  let projectId: string

  const newProject = async () => {
    const id = randomUUID()
    createdUsers.push(id)
    await ensureUser({ id, email: `m-${id}@example.test` })
    const context = await getUserContext(id)
    const owner: Viewer = { kind: 'user', userId: id }
    const project = await makeProject(owner, {
      name: 'monitored',
      url: 'https://monitored.test/',
      orgId: context!.orgId,
    })
    return { viewer: owner, projectId: project!.id }
  }

  beforeAll(async () => {
    const made = await newProject()
    viewer = made.viewer
    projectId = made.projectId
  })

  afterAll(async () => {
    if (createdUsers.length) await db.delete(users).where(inArray(users.id, createdUsers))
  })

  describe('setMonitor', () => {
    it('creates a monitor and toggles it without creating a second', async () => {
      // The schema puts a unique index on (project, type); this proves the
      // upsert honours it rather than relying on nobody clicking twice.
      await setMonitor(projectId, viewer, { type: 'uptime', enabled: true })
      await setMonitor(projectId, viewer, { type: 'uptime', enabled: false })
      await setMonitor(projectId, viewer, { type: 'uptime', enabled: true })

      const list = await listMonitors(projectId, viewer)
      const uptime = list.filter((m) => m.type === 'uptime')
      expect(uptime).toHaveLength(1)
      expect(uptime[0]?.enabled).toBe(true)
    })

    it('refuses a project the viewer does not own', async () => {
      const other = await newProject()
      expect(await setMonitor(projectId, other.viewer, { type: 'uptime', enabled: true })).toBeNull()
      expect(await listMonitors(projectId, other.viewer)).toEqual([])
      expect(await listMonitors(projectId, ANONYMOUS)).toEqual([])
    })
  })

  describe('the scheduler sweep', () => {
    it('picks up a monitor that has never run', async () => {
      const made = await newProject()
      await setMonitor(made.projectId, made.viewer, { type: 'uptime', enabled: true })

      const due = await dueMonitorsForScheduler()
      const mine = due.find((m) => m.projectId === made.projectId)
      expect(mine?.projectUrl).toBe('https://monitored.test/')
      // Carried in the event so a job needs no second lookup.
      expect(mine?.ownerId).toBe((made.viewer as { userId: string }).userId)
    })

    it('skips a monitor that ran inside its own interval', async () => {
      const made = await newProject()
      const monitor = await setMonitor(made.projectId, made.viewer, {
        type: 'rescan',
        enabled: true,
        intervalS: 86_400,
      })
      await recordMonitorRun(monitor!.id, { ok: true })

      const due = await dueMonitorsForScheduler()
      expect(due.some((m) => m.id === monitor!.id)).toBe(false)
    })

    it('picks it up again once the interval has passed', async () => {
      const made = await newProject()
      const monitor = await setMonitor(made.projectId, made.viewer, {
        type: 'uptime',
        enabled: true,
        intervalS: 60,
      })
      await recordMonitorRun(monitor!.id, { ok: true })
      // Reach into the row rather than waiting a minute in a test.
      await db
        .update(monitors)
        .set({ lastRunAt: sql`now() - interval '2 minutes'` })
        .where(eq(monitors.id, monitor!.id))

      expect((await dueMonitorsForScheduler()).some((m) => m.id === monitor!.id)).toBe(true)
    })

    it('never picks up a disabled monitor', async () => {
      const made = await newProject()
      const monitor = await setMonitor(made.projectId, made.viewer, { type: 'uptime', enabled: false })
      expect((await dueMonitorsForScheduler()).some((m) => m.id === monitor!.id)).toBe(false)
    })
  })

  describe('recordMonitorRun', () => {
    it('writes the event and advances the monitor together', async () => {
      // Separately, a monitor could advance without an event and silently skip
      // its next turn, or record an event and immediately run again.
      const made = await newProject()
      const monitor = await setMonitor(made.projectId, made.viewer, { type: 'uptime', enabled: true })
      await recordMonitorRun(monitor!.id, { ok: false, statusCode: 503, latencyMs: 120, detail: 'HTTP 503' })

      const [row] = await db.select().from(monitors).where(eq(monitors.id, monitor!.id))
      const events = await db.select().from(monitorEvents).where(eq(monitorEvents.monitorId, monitor!.id))
      expect(row?.lastStatus).toBe('failed')
      expect(row?.lastRunAt).toBeInstanceOf(Date)
      expect(events[0]?.statusCode).toBe(503)
    })
  })

  describe('consecutiveFailures — the two-strike rule', () => {
    const run = async (monitorId: string, results: boolean[]) => {
      for (const ok of results) await recordMonitorRun(monitorId, { ok })
    }

    it('counts a single failure as one', async () => {
      const made = await newProject()
      const monitor = await setMonitor(made.projectId, made.viewer, { type: 'uptime', enabled: true })
      await run(monitor!.id, [true, false])
      expect(await consecutiveFailures(monitor!.id)).toBe(1)
    })

    it('counts a run of failures', async () => {
      const made = await newProject()
      const monitor = await setMonitor(made.projectId, made.viewer, { type: 'uptime', enabled: true })
      await run(monitor!.id, [false, false, false])
      expect(await consecutiveFailures(monitor!.id)).toBe(3)
    })

    it('resets the moment the site answers again', async () => {
      // Which is what makes a recovery a recovery, rather than a lower count.
      const made = await newProject()
      const monitor = await setMonitor(made.projectId, made.viewer, { type: 'uptime', enabled: true })
      await run(monitor!.id, [false, false, true])
      expect(await consecutiveFailures(monitor!.id)).toBe(0)
    })
  })

  describe('recordAlertOnce — the dedup', () => {
    it('sends the first alert of a kind', async () => {
      const made = await newProject()
      const alert = await recordAlertOnce({
        projectId: made.projectId,
        kind: 'downtime',
        channel: 'email',
        payload: { url: 'https://monitored.test/' },
      })
      expect(alert).not.toBeNull()
    })

    it('refuses a second of the same kind on the same day', async () => {
      // The test this whole file exists for. A site failing every minute must
      // produce one message, not one an hour.
      const made = await newProject()
      const send = () =>
        recordAlertOnce({ projectId: made.projectId, kind: 'downtime', channel: 'email', payload: {} })

      expect(await send()).not.toBeNull()
      for (let i = 0; i < 10; i += 1) expect(await send()).toBeNull()

      expect(await listAlerts(made.projectId, made.viewer)).toHaveLength(1)
    })

    it('treats a different kind as a different alert', async () => {
      // Downtime and an expiring certificate are two things worth knowing, even
      // on the same bad day.
      const made = await newProject()
      await recordAlertOnce({ projectId: made.projectId, kind: 'downtime', channel: 'email', payload: {} })
      await recordAlertOnce({ projectId: made.projectId, kind: 'score-drop', channel: 'email', payload: {} })
      expect(await listAlerts(made.projectId, made.viewer)).toHaveLength(2)
    })

    it('treats each expiry threshold as its own alert', async () => {
      // Crossing 30 days and later 7 are different messages; folding them into
      // one kind would mean the urgent one is swallowed by the early one.
      const made = await newProject()
      for (const days of [30, 14, 7]) {
        await recordAlertOnce({
          projectId: made.projectId,
          kind: `certificate-expiry-${days}`,
          channel: 'email',
          payload: { daysLeft: days },
        })
      }
      expect(await listAlerts(made.projectId, made.viewer)).toHaveLength(3)
    })

    it('lets yesterday\'s alert of the same kind through today', async () => {
      const made = await newProject()
      const first = await recordAlertOnce({
        projectId: made.projectId,
        kind: 'downtime',
        channel: 'email',
        payload: {},
      })
      await db
        .update(alerts)
        .set({ createdAt: sql`now() - interval '2 days'` })
        .where(eq(alerts.id, first!.id))

      expect(
        await recordAlertOnce({ projectId: made.projectId, kind: 'downtime', channel: 'email', payload: {} }),
      ).not.toBeNull()
    })

    it('refuses to list another account\'s alerts', async () => {
      const made = await newProject()
      await recordAlertOnce({ projectId: made.projectId, kind: 'downtime', channel: 'email', payload: {} })
      expect(await listAlerts(made.projectId, ANONYMOUS)).toEqual([])
      expect(await listAlerts(made.projectId, viewer)).toEqual([])
    })
  })
})
