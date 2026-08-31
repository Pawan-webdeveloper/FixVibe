/**
 * Every read and write of a repo scan. Nothing else in the codebase touches
 * the `repo_scans` or `repo_findings` tables.
 *
 * Two rules this module exists to enforce, both of which are easy to get wrong
 * once and never notice:
 *
 *  1. A repo scan is written atomically. `completeRepoScan` puts the findings
 *     and the scan's own row in one transaction, so there is no window where a
 *     scan reads 'done' while half its findings are missing — a state the
 *     report page would render as "your repo is fine".
 *
 *  2. Nothing is readable without saying who is asking. There is deliberately
 *     no unfiltered `getRepoScan(id)` export; see queries/viewer.ts for why
 *     that matters more here than in a project using RLS.
 */

import { and, desc, eq, gte } from 'drizzle-orm'
import type { RepoFinding, RepoScanScores } from '@scanlyfix/repo-checks'
import { db } from '../client.ts'
import {
  repoFindings,
  repoScans,
  type RepoFindingRow,
  type RepoScan,
  type RepoScanContextMeta,
  type RepoScanProfile,
} from '../schema.ts'
import type { Viewer } from './viewer.ts'

export interface RepoScanWithFindings extends RepoScan {
  findings: RepoFindingRow[]
}

export interface CreateRepoScanInput {
  repoId: string
  profile: RepoScanProfile
  /** Both required by the column, and both known before the scan starts. */
  engineVersion: string
  checksRun: number
  requestedBy?: string | null
}

export interface RepoScanResult {
  scores: RepoScanScores
  findings: readonly RepoFinding[]
  contextMeta: RepoScanContextMeta
  checkErrors: readonly { checkId: string; message: string }[]
  durationMs: number
}

/**
 * Postgres caps a statement at 65535 bound parameters. Findings carry ten
 * columns each, so the real ceiling is ~6500 rows — this leaves an order of
 * magnitude of headroom for the deep code-quality checks that multiply
 * finding counts by the number of files.
 */
const INSERT_CHUNK = 500

/**
 * Reserves a repo scan row. The work has NOT started yet, so the row says
 * 'queued' and `startedAt` stays null until markRepoScanRunning writes it.
 *
 * See the site `createScan` for why the reserve/execute split is load-bearing:
 * a job the queue never delivered would sit in 'running' forever, and
 * `startedAt - createdAt` is the queue latency the dashboard charts.
 */
export async function createRepoScan(input: CreateRepoScanInput): Promise<{ id: string }> {
  const inserted = await db
    .insert(repoScans)
    .values({
      repoId: input.repoId,
      profile: input.profile,
      engineVersion: input.engineVersion,
      checksRun: input.checksRun,
      requestedBy: input.requestedBy ?? null,
      status: 'queued',
    })
    .returning({ id: repoScans.id })

  const row = inserted[0]
  if (!row) throw new Error('createRepoScan: insert returned no row')
  return row
}

/**
 * A worker has picked this job up.
 *
 * Deliberately does not guard on the current status: a retry re-entering
 * 'running' from 'running' is correct, and `startedAt` moving to the latest
 * attempt is what you want when reading how long the work actually took.
 */
export async function markRepoScanRunning(scanId: string): Promise<void> {
  await db
    .update(repoScans)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(repoScans.id, scanId))
}

export async function completeRepoScan(scanId: string, result: RepoScanResult): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(repoFindings).where(eq(repoFindings.repoScanId, scanId))

    const rows = result.findings.map((f) => ({
      repoScanId: scanId,
      checkId: f.checkId,
      category: f.category,
      severity: f.severity,
      title: f.title,
      description: f.description,
      evidence: f.evidence ?? null,
      remediation: f.remediation,
      fixPrompt: f.fixPrompt,
    }))

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await tx.insert(repoFindings).values(rows.slice(i, i + INSERT_CHUNK))
    }

    await tx
      .update(repoScans)
      .set({
        status: 'done',
        finishedAt: new Date(),
        durationMs: result.durationMs,
        scores: result.scores,
        contextMeta: result.contextMeta,
        checkErrors: [...result.checkErrors],
      })
      .where(eq(repoScans.id, scanId))
  })
}

/** A repo scan that could not be produced — see the site `failScan` for the rationale. */
export async function failRepoScan(scanId: string, error: string, durationMs?: number): Promise<void> {
  await db
    .update(repoScans)
    .set({ status: 'failed', finishedAt: new Date(), error, durationMs: durationMs ?? null })
    .where(eq(repoScans.id, scanId))
}

/**
 * The only way to read a repo scan. A repo scan is always owned by an account
 * (the GitHub App is per-user; we do not support anonymous repo scans), so
 * the access rule is uniform: the requester OR the owner of the installation
 * the repo belongs to may read it.
 */
export async function getRepoScanForViewer(
  scanId: string,
  viewer: Viewer,
): Promise<RepoScanWithFindings | null> {
  if (viewer.kind !== 'user') return null

  const scan = await db.query.repoScans.findFirst({
    where: eq(repoScans.id, scanId),
    with: {
      // Worst-first, exactly like the site findings read — see getScanForViewer
      // for why `asc(severity)` is correct against a Postgres enum declared
      // critical → info, and why a relation join without an orderBy would
      // come back low-severity first.
      findings: { orderBy: (f, { asc }) => [asc(f.severity), asc(f.checkId)] },
      repo: { with: { installation: { columns: { userId: true } } } },
    },
  })
  if (!scan) return null

  const isOwner = scan.requestedBy === viewer.userId || scan.repo.installation.userId === viewer.userId
  if (!isOwner) return null
  return scan
}

/**
 * A repo's scans, newest first. Findings are not joined — the history view
 * shows scores and dates, and pulling every finding of every scan to render a
 * list of numbers is the same mistake the site `listScansForProject` refuses.
 */
export async function listRepoScansForRepo(repoId: string, limit = 30): Promise<RepoScan[]> {
  return db.query.repoScans.findMany({
    where: eq(repoScans.repoId, repoId),
    orderBy: desc(repoScans.createdAt),
    limit,
  })
}

/**
 * The most recent finished repo scan of this repo, for reuse instead of
 * re-cloning somebody's tree. Only 'done' scans qualify: a failed one should
 * be retryable straight away, and a running one has nothing to show yet.
 */
export async function findRecentRepoScan(
  repoId: string,
  profile: RepoScanProfile,
  since: Date,
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: repoScans.id })
    .from(repoScans)
    .where(
      and(
        eq(repoScans.repoId, repoId),
        eq(repoScans.profile, profile),
        eq(repoScans.status, 'done'),
        gte(repoScans.createdAt, since),
      ),
    )
    .orderBy(desc(repoScans.createdAt))
    .limit(1)
  return rows[0] ?? null
}
