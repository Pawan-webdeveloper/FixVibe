/**
 * Every read and write of a scan. Nothing else in the codebase touches the
 * `scans` or `findings` tables.
 *
 * Two rules this module exists to enforce, both of which are easy to get wrong
 * once and never notice:
 *
 *  1. A scan is written atomically. `completeScan` puts the findings and the
 *     scan's own row in one transaction, so there is no window where a scan
 *     reads 'done' while half its findings are missing — a state the report
 *     page would render as "your site is fine".
 *
 *  2. Nothing is readable without saying who is asking. There is deliberately
 *     no unfiltered `getScan(id)` export; see queries/viewer.ts for why that
 *     matters more here than in a project using RLS.
 */

import { and, count, desc, eq, gte, isNull, min } from 'drizzle-orm'
import type { Finding, ScanScores } from '@darvin/checks'
import { db } from '../client.ts'
import {
  findings,
  scans,
  type FindingRow,
  type Scan,
  type ScanContextMeta,
  type ScanProfile,
} from '../schema.ts'
import type { Viewer } from './viewer.ts'

export interface ScanWithFindings extends Scan {
  findings: FindingRow[]
}

/**
 * What a caller supplies to open a scan — deliberately narrower than the
 * table's insert type, which would also accept `status`, `scores` and the
 * timestamps this module owns.
 */
export interface CreateScanInput {
  /** Already normalized by lib/url.ts — this layer does not parse URLs. */
  url: string
  profile: ScanProfile
  /** Both required by the column, and both known before the scan starts. */
  engineVersion: string
  checksRun: number
  projectId?: string | null
  requestedBy?: string | null
  /** Hashed upstream. A raw address must never reach this table. */
  anonIpHash?: string | null
}

export interface ScanResult {
  scores: ScanScores
  findings: readonly Finding[]
  contextMeta: ScanContextMeta
  checkErrors: readonly { checkId: string; message: string }[]
  durationMs: number
}

/**
 * Postgres caps a statement at 65535 bound parameters. Findings carry ten
 * columns each, so the real ceiling is ~6500 rows — this leaves an order of
 * magnitude of headroom for the Phase 6 crawl, which multiplies finding counts
 * by the number of pages.
 */
const INSERT_CHUNK = 500

/**
 * Opens a scan in the 'running' state, because Phase 2 runs it inline and the
 * work begins immediately. When the queue arrives, enqueuing gets its own
 * function that writes 'queued' and lets the worker move it on.
 */
export async function createScan(input: CreateScanInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(scans)
    .values({
      url: input.url,
      // Derived rather than accepted, so the column the rate limiter trusts
      // can never disagree with the URL stored next to it.
      targetHost: new URL(input.url).hostname,
      profile: input.profile,
      engineVersion: input.engineVersion,
      checksRun: input.checksRun,
      projectId: input.projectId ?? null,
      requestedBy: input.requestedBy ?? null,
      anonIpHash: input.anonIpHash ?? null,
      status: 'running',
      startedAt: new Date(),
    })
    .returning({ id: scans.id })

  if (!row) throw new Error('createScan: insert returned no row')
  return row
}

/**
 * Writes the findings and closes the scan in one transaction.
 *
 * Idempotent on `scanId`: existing findings are cleared first, so a retried
 * job — Inngest retries by design in Phase 5 — produces the same rows rather
 * than a second copy of every finding.
 */
export async function completeScan(scanId: string, result: ScanResult): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(findings).where(eq(findings.scanId, scanId))

    const rows = result.findings.map((f) => ({
      scanId,
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
      await tx.insert(findings).values(rows.slice(i, i + INSERT_CHUNK))
    }

    await tx
      .update(scans)
      .set({
        status: 'done',
        finishedAt: new Date(),
        durationMs: result.durationMs,
        scores: result.scores,
        contextMeta: result.contextMeta,
        checkErrors: [...result.checkErrors],
      })
      .where(eq(scans.id, scanId))
  })
}

/**
 * A scan that could not be produced: an SSRF-blocked target, a host that never
 * answered, a TLS handshake that failed. All of those are results the user is
 * owed an explanation for, not server errors — so they land here and the scan
 * page renders them, rather than the request throwing a 500.
 */
export async function failScan(scanId: string, error: string, durationMs?: number): Promise<void> {
  await db
    .update(scans)
    // durationMs is recorded for failures too: a scan that died after 10s hit a
    // timeout, one that died after 40ms hit a DNS error, and telling those two
    // apart from a support question is otherwise guesswork.
    .set({ status: 'failed', finishedAt: new Date(), error, durationMs: durationMs ?? null })
    .where(eq(scans.id, scanId))
}

/**
 * The only way to read a scan.
 *
 * Two access rules, and the split matters:
 *
 *  - An anonymous scan (no project, no requester) is readable by anyone
 *    holding the id. That is the product: paste a URL, get a link, share it.
 *    The id is a random UUID and is the capability.
 *
 *  - A scan attached to a project or a user belongs to that account, and only
 *    its owner may read it. Treating these the same as anonymous scans would
 *    make every customer's history public to anyone who guessed an id;
 *    treating anonymous scans as private would break the shareable report.
 */
export async function getScanForViewer(scanId: string, viewer: Viewer): Promise<ScanWithFindings | null> {
  const scan = await db.query.scans.findFirst({
    where: eq(scans.id, scanId),
    with: {
      findings: true,
      project: { columns: { ownerId: true } },
    },
  })
  if (!scan) return null

  const { project, ...row } = scan
  const isAnonymous = row.projectId === null && row.requestedBy === null
  if (isAnonymous) return row

  if (viewer.kind !== 'user') return null
  const owns = row.requestedBy === viewer.userId || project?.ownerId === viewer.userId
  return owns ? row : null
}

/* -------------------------------------------------------------------------- */
/* Rate limiting and deduplication                                            */
/* -------------------------------------------------------------------------- */

/**
 * These count rows in `scans`, which means they count scans that were actually
 * STARTED — the expensive thing — rather than HTTP requests. A flood of
 * requests that never becomes a scan costs a count query and nothing else, and
 * belongs to the CDN rather than to this table.
 *
 * Postgres rather than Redis on purpose: a scan is seconds of network work, so
 * request volume here is inherently low, and the columns were already being
 * written. If that stops being true, replace the bodies — the callers only see
 * the counts.
 */

/**
 * How many scans matched, and when the earliest of them ran.
 *
 * The timestamp comes back from the same query because the caller needs it
 * only to say when the window reopens — and a limit message without a time is
 * a support ticket.
 */
export interface WindowUsage {
  count: number
  oldest: Date | null
}

/** How many scans this visitor has started since `since`. */
export async function countScansByIpSince(anonIpHash: string, since: Date): Promise<WindowUsage> {
  const [row] = await db
    .select({ n: count(), oldest: min(scans.createdAt) })
    .from(scans)
    .where(and(eq(scans.anonIpHash, anonIpHash), gte(scans.createdAt, since)))
  return { count: row?.n ?? 0, oldest: row?.oldest ?? null }
}

/**
 * How many scans ANYONE has started against this host since `since`.
 *
 * The limit other people are protected by. Without it, ten visitors with ten
 * addresses can point this service at one small site, and the abuse report
 * arrives at our host rather than theirs.
 */
export async function countScansByHostSince(targetHost: string, since: Date): Promise<WindowUsage> {
  const [row] = await db
    .select({ n: count(), oldest: min(scans.createdAt) })
    .from(scans)
    .where(and(eq(scans.targetHost, targetHost), gte(scans.createdAt, since)))
  return { count: row?.n ?? 0, oldest: row?.oldest ?? null }
}

/**
 * The most recent finished scan of this exact URL and depth, for reuse instead
 * of re-fetching someone else's server.
 *
 * Restricted to scans that are themselves anonymous. A scan belonging to a
 * project is private, and handing its id back as a cache hit would both leak
 * that the project exists and send the visitor to a report they cannot read.
 *
 * Only 'done' scans qualify: a failed one should be retryable straight away,
 * and a running one has nothing to show yet.
 */
export async function findRecentAnonymousScan(
  url: string,
  profile: ScanProfile,
  since: Date,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: scans.id })
    .from(scans)
    .where(
      and(
        eq(scans.url, url),
        eq(scans.profile, profile),
        eq(scans.status, 'done'),
        isNull(scans.projectId),
        isNull(scans.requestedBy),
        gte(scans.createdAt, since),
      ),
    )
    .orderBy(desc(scans.createdAt))
    .limit(1)
  return row ?? null
}
