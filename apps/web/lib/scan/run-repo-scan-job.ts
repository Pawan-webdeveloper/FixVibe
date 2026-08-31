/**
 * The seam between "somebody asked for a repo scan" and "a repo scan happened".
 *
 * Direct parallel of lib/scan/run-scan-job.ts, on the repo engine instead of
 * the site engine. The shape of the contract is identical on purpose:
 *
 *   - Two functions, one for callers that only need an id and one for callers
 *     that want the work to run synchronously. The queue calls the first
 *     (startRepoScanJob) + the second (executeRepoScan); an inline call site
 *     could call them together.
 *
 *   - A failing scan is a RESULT, recorded on the row, not an exception thrown
 *     to the caller. throw is reserved for our own failures (the database
 *     being unreachable, a worker that refuses to start), so a slow clone or
 *     a deleted repo surfaces as a `failed` row with an explanation rather
 *     than a 500 on the page that asked for it.
 *
 * Phase A calls a stub worker that returns canned findings, so the queue →
 * persist → report-page loop is testable before the real github-scanner is
 * built. Phase B replaces `runRepoScan` with an HTTP call to the worker
 * (`fetch(SCANLYFIX_REPO_SCANNER_URL, …)`) and nothing above this line moves.
 */

import 'server-only'
import { allRepoChecks, computeRepoScores, REPO_ENGINE_VERSION, type RepoFinding, type RepoScanScores } from '@scanlyfix/repo-checks'
import {
  completeRepoScan,
  createRepoScan,
  failRepoScan,
  markRepoScanRunning,
  type RepoScanContextMeta,
  type RepoScanProfile,
} from '@scanlyfix/db'
import { runRepoScan as callWorker } from '@/lib/repo-scanner.ts'

export interface RepoScanRequest {
  repoId: string
  installationId: number
  owner: string
  name: string
  defaultBranch: string
  profile: RepoScanProfile
  requestedBy?: string | null
}

/**
 * Reserve a repo scan and hand back its id, without doing any of the work.
 * Mirrors startScanJob in the site engine: a clone + gitleaks + osv-scanner run
 * is closer to a minute than to a request, so the caller needs an id to
 * redirect to and to poll while the job runs somewhere else.
 */
export async function startRepoScanJob(request: RepoScanRequest): Promise<string> {
  const { id } = await createRepoScan({
    repoId: request.repoId,
    profile: request.profile,
    engineVersion: REPO_ENGINE_VERSION,
    checksRun: allRepoChecks.length,
    requestedBy: request.requestedBy ?? null,
  })
  return id
}

/**
 * Do the work against an already-reserved repo scan row.
 *
 * Idempotent for the same reason executeScan is: a retry re-enters the scan
 * and `completeRepoScan` clears the findings first, so a re-run replaces the
 * rows rather than doubling them.
 */
export async function executeRepoScan(id: string, request: RepoScanRequest): Promise<void> {
  await markRepoScanRunning(id)
  const startedAt = performance.now()

  try {
    const worker = await callWorker({
      installationId: request.installationId,
      owner: request.owner,
      name: request.name,
      defaultBranch: request.defaultBranch,
      profile: request.profile,
    })

    const findings: readonly RepoFinding[] = worker.findings
    const errors = worker.errors
    const scores: RepoScanScores = computeRepoScores(findings, allRepoChecks, errors)

    const contextMeta: RepoScanContextMeta = {
      defaultBranch: request.defaultBranch,
      framework: null,
      profile: request.profile,
      sizeKib: null,
      installationId: request.installationId,
    }

    await completeRepoScan(id, {
      scores,
      findings,
      contextMeta,
      checkErrors: errors,
      durationMs: Math.round(performance.now() - startedAt),
    })
  } catch (error) {
    await failRepoScan(id, describeFailure(error), Math.round(performance.now() - startedAt))
  }
}

/**
 * Reserve and run, in one call. Available to a future inline path the same way
 * `runScanJob` is — not used today because a repo scan always queues.
 */
export async function runRepoScanJob(request: RepoScanRequest): Promise<string> {
  const id = await startRepoScanJob(request)
  await executeRepoScan(id, request)
  return id
}

/**
 * A sentence a visitor can act on, never an internal one. Anything not a known
 * worker failure is logged with its real message and the visitor gets a
 * neutral line — same discipline as describeFailure in the site engine.
 */
function describeFailure(error: unknown): string {
  console.error('[run-repo-scan-job] unexpected failure', error)
  return 'The repo scan stopped unexpectedly. This is a problem on our side, not with the repository.'
}
