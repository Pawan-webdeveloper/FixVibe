/**
 * Projects and their scan history.
 *
 * Same rule as queries/scans.ts: every function takes a Viewer and there is no
 * unfiltered variant. Drizzle connects as the database owner, so Postgres
 * row-level security never applies — this file is the access control, not a
 * convenience layer over it.
 */

import { and, desc, eq, isNull } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db } from '../client.ts'
import { projects, scans, type Project, type Scan } from '../schema.ts'
import type { Viewer } from './viewer.ts'

export interface NewProjectInput {
  name: string
  /** Normalized upstream. This layer stores URLs, it does not parse them. */
  url: string
  orgId: string
}

export async function listProjects(viewer: Viewer): Promise<Project[]> {
  if (viewer.kind !== 'user') return []
  return db.query.projects.findMany({
    where: eq(projects.ownerId, viewer.userId),
    orderBy: desc(projects.createdAt),
  })
}

export async function getProject(projectId: string, viewer: Viewer): Promise<Project | null> {
  if (viewer.kind !== 'user') return null
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, viewer.userId)),
  })
  return project ?? null
}

export async function createProject(viewer: Viewer, input: NewProjectInput): Promise<Project | null> {
  if (viewer.kind !== 'user') return null
  const [project] = await db
    .insert(projects)
    .values({
      ownerId: viewer.userId,
      orgId: input.orgId,
      name: input.name,
      url: input.url,
      slug: slugFor(input.url),
    })
    .returning()
  return project ?? null
}

/**
 * A project's scans, newest first.
 *
 * Findings are not joined: the history view shows scores and dates, and pulling
 * every finding of every scan to render a list of numbers is the kind of query
 * that is fine with three scans and unusable with three hundred.
 */
export async function listScansForProject(projectId: string, viewer: Viewer, limit = 30) {
  if (await getProject(projectId, viewer)) {
    return db.query.scans.findMany({
      where: eq(scans.projectId, projectId),
      orderBy: desc(scans.createdAt),
      limit,
    })
  }
  return []
}

/**
 * Attach an anonymous scan to a new project owned by the viewer.
 *
 * This is the funnel. A stranger scans, likes the report, signs up — and this
 * is what turns that report into something in their account instead of a link
 * they have to keep. Without it they sign up into an empty dashboard, which is
 * the highest-converting moment in the product spent on nothing.
 *
 * Only genuinely anonymous scans can be claimed. Guarding on projectId and
 * requestedBy being null in the UPDATE itself means two people racing on the
 * same shared link cannot both take it, and neither can anyone re-claim a scan
 * that already belongs to someone.
 */
export async function claimScan(
  scanId: string,
  viewer: Viewer,
  orgId: string,
): Promise<{ projectId: string } | null> {
  if (viewer.kind !== 'user') return null

  return db.transaction(async (tx) => {
    const scan = await tx.query.scans.findFirst({
      where: eq(scans.id, scanId),
      columns: { id: true, url: true, projectId: true, requestedBy: true },
    })
    if (!scan || scan.projectId !== null || scan.requestedBy !== null) return null

    const [project] = await tx
      .insert(projects)
      .values({
        ownerId: viewer.userId,
        orgId,
        name: hostOf(scan.url),
        url: scan.url,
        slug: slugFor(scan.url),
      })
      .returning({ id: projects.id })
    if (!project) return null

    const claimed = await tx
      .update(scans)
      .set({ projectId: project.id, requestedBy: viewer.userId })
      // Re-checked here, not only above: between the read and the write the
      // scan may have been claimed by a concurrent request on the same link.
      .where(and(eq(scans.id, scanId), isNull(scans.projectId), isNull(scans.requestedBy)))
      .returning({ id: scans.id })

    if (claimed.length === 0) {
      // Someone else won the race. Remove the project we speculatively created
      // rather than rolling back — tx.rollback() throws, and a lost race is a
      // normal outcome here, not an error the caller should have to catch.
      await tx.delete(projects).where(eq(projects.id, project.id))
      return null
    }
    return { projectId: project.id }
  })
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * Public handle for /status/[slug]. A short random suffix keeps two people
 * scanning the same domain from colliding without a retry loop, and the UUID
 * never appears in a shareable URL.
 */
function slugFor(url: string): string {
  const host = hostOf(url).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  return `${host || 'site'}-${randomUUID().slice(0, 8)}`
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export interface ProjectSummary {
  project: Project
  latest: Scan | null
  previous: Scan | null
  /**
   * Difference in overall score, or null when the two scans are not comparable
   * — a different engine version or scan depth means the ruler changed, not the
   * site. Showing a number there would report our own deploy as the customer's
   * regression, which is how a monitoring product teaches people to ignore it.
   */
  delta: number | null
}

export async function listProjectSummaries(viewer: Viewer): Promise<ProjectSummary[]> {
  if (viewer.kind !== 'user') return []

  const owned = await db.query.projects.findMany({
    where: eq(projects.ownerId, viewer.userId),
    orderBy: desc(projects.createdAt),
    with: {
      // Two is all the dashboard needs: the current reading and the one to
      // compare it against.
      scans: { orderBy: desc(scans.createdAt), limit: 2 },
    },
  })

  return owned.map(({ scans: recent, ...project }) => {
    const [latest = null, previous = null] = recent
    return { project, latest, previous, delta: comparableDelta(latest, previous) }
  })
}

function comparableDelta(latest: Scan | null, previous: Scan | null): number | null {
  if (!latest?.scores || !previous?.scores) return null
  if (latest.status !== 'done' || previous.status !== 'done') return null
  if (latest.engineVersion !== previous.engineVersion) return null
  if (latest.profile !== previous.profile) return null
  // A pillar that could not be fully measured makes the total unreliable in a
  // way a single number cannot express, so no number is offered.
  if (latest.scores.degraded.length > 0 || previous.scores.degraded.length > 0) return null
  return latest.scores.overall - previous.scores.overall
}
