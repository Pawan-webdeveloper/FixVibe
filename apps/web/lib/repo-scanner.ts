/**
 * The seam between the repo-scan job and the worker that does the work.
 *
 * Phase A (this file) returns canned findings for a single synthetic
 * critical finding, so the queue → persist → page loop is end-to-end
 * testable without GitHub credentials and without the worker container.
 *
 * Phase B replaces the body with an HTTP POST to SCANLYFIX_REPO_SCANNER_URL
 * (mirroring the way the site `runScanJob` calls the browser scanner). The
 * signature here is the contract: anything that does not fit a `RepoWorkerScan`
 * does not belong on this call. Keeping the seam thin means swapping the
 * implementation does not leak worker details into the Inngest function or
 * the executor.
 */

import 'server-only'
import type { RepoScanProfile } from '@scanlyfix/db'
import type { RepoFinding, RepoCheckError } from '@scanlyfix/repo-checks'

export interface RepoWorkerRequest {
  installationId: number
  owner: string
  name: string
  defaultBranch: string
  profile: RepoScanProfile
}

export interface RepoWorkerResult {
  findings: RepoFinding[]
  errors: RepoCheckError[]
}

const SCANNER_URL = process.env['SCANLYFIX_REPO_SCANNER_URL']
const SCANNER_TOKEN = process.env['SCANLYFIX_REPO_SCANNER_TOKEN']

/**
 * Run a repo scan through the worker. Throws on our own failures (network,
 * auth, the worker not configured) and returns a `RepoWorkerResult` for the
 * rest, so the executor can `completeRepoScan` with the findings regardless
 * of how many came back.
 */
export async function runRepoScan(request: RepoWorkerRequest): Promise<RepoWorkerResult> {
  if (SCANNER_URL && SCANNER_TOKEN) {
    // Phase B: real call. Implemented as a guarded branch so Phase A is
    // fully testable without the worker, and Phase B can ship by setting
    // the two env vars — the executor does not change.
    return callWorker(request)
  }
  return stubScan(request)
}

async function callWorker(request: RepoWorkerRequest): Promise<RepoWorkerResult> {
  const res = await fetch(SCANNER_URL!, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-scanner-token': SCANNER_TOKEN! },
    body: JSON.stringify(request),
    // A clone + gitleaks + osv-scanner run is closer to a minute than to a
    // request; the worker has its own timeout, so 5 minutes is the cap.
    signal: AbortSignal.timeout(5 * 60_000),
  })
  if (!res.ok) {
    throw new Error(`repo scanner responded ${res.status}: ${await res.text()}`)
  }
  const json = (await res.json()) as { findings: RepoFinding[]; errors: RepoCheckError[] }
  return { findings: json.findings ?? [], errors: json.errors ?? [] }
}

/**
 * Phase A stub: a single critical finding per scan, so a worker-less
 * environment can prove the queue persists, the page renders, and the
 * severity ordering is honoured. Real findings start arriving in Phase B.
 */
function stubScan(request: RepoWorkerRequest): Promise<RepoWorkerResult> {
  return Promise.resolve({
    findings: [
      {
        checkId: 'supply-chain.pr-target-injection',
        category: 'supply-chain',
        severity: 'critical',
        title: 'pull_request_target checks out PR head (script injection)',
        description:
          `Stub critical finding for ${request.owner}/${request.name}. The real worker would ` +
          'read the actual .github/workflows/*.yml files; this stub proves the queue → persist ' +
          '→ report loop.',
        remediation: 'Replace pull_request_target with pull_request for any workflow that must run the PR code.',
        fixPrompt:
          'This is a stub finding from the Phase A worker placeholder; no action is required. ' +
          'The real worker ships in Phase B.',
      },
    ],
    errors: [],
  })
}
