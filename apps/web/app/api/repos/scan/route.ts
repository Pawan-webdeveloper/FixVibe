/**
 * POST /api/repos/scan — the endpoint the Repositories page talks to.
 *
 * Mirrors POST /api/scan, on the repo engine. Two differences that matter:
 *
 *   1. A repo scan ALWAYS queues. A site `fast` scan runs inline; a repo
 *      `shallow` cannot, because a clone is a network round trip to GitHub
 *      even before we run any checks. The same `startRepoScanJob +
 *      inngest.send` pattern as the deep site scan therefore applies to both
 *      profiles.
 *
 *   2. Authorization is per-repo, not per-account. A repo belongs to a
 *      specific installation the user owns; the `getRepoWithInstallationForViewer`
 *      join enforces that, so a forged body that names someone else's repo id
 *      returns 404 without ever reaching the queue.
 */

import { NextResponse } from 'next/server'
import type { RepoScanProfile } from '@scanlyfix/db'
import { getRepoWithInstallationForViewer } from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'
import { inngest, EVENTS } from '@/lib/inngest.ts'
import { startRepoScanJob } from '@/lib/scan/run-repo-scan-job.ts'

/** The engine clones a repo even for the shallow profile, so it must run on Node. */
export const runtime = 'nodejs'

/**
 * Generous: a shallow scan is ~10s (API only); a deep one is bounded by the
 * github-scanner worker's own 5-minute timeout. This ceiling is the request
 * itself, which only exists long enough to reserve + enqueue.
 */
export const maxDuration = 30

interface RepoScanBody {
  repoId?: unknown
  profile?: unknown
}

const PROFILES: readonly RepoScanProfile[] = ['shallow', 'deep']

function isProfile(value: unknown): value is RepoScanProfile {
  return typeof value === 'string' && PROFILES.includes(value as RepoScanProfile)
}

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

export async function POST(request: Request) {
  let body: RepoScanBody
  try {
    body = (await request.json()) as RepoScanBody
  } catch {
    return fail('Expected a JSON body containing a repoId.', 400)
  }

  if (typeof body.repoId !== 'string') {
    return fail('Expected a JSON body containing a repoId.', 400)
  }
  // Default to shallow: fast, no clone, no gitleaks/osv on the target's tree.
  // The Repositories page exposes both as separate buttons.
  const profile: RepoScanProfile = body.profile === undefined ? 'shallow' : (body.profile as RepoScanProfile)
  if (!isProfile(profile)) return fail(`Unknown scan profile. Use one of: ${PROFILES.join(', ')}.`, 400)

  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return fail('Sign in to scan a repository. It takes a moment and keeps your reports.', 401)
  }

  // Cross-account guard: the repo + its installation id come back together
  // after a single join that also enforces the viewer owns the installation.
  // A forged body that names someone else's repo id returns 404 here and
  // never reaches the queue.
  const owned = await getRepoWithInstallationForViewer(body.repoId, viewer)
  if (!owned) return fail('Repository not found.', 404)

  try {
    const repoScanId = await startRepoScanJob({
      repoId: owned.repo.id,
      installationId: owned.installationId,
      owner: owned.repo.owner,
      name: owned.repo.name,
      defaultBranch: owned.repo.defaultBranch,
      profile,
      requestedBy: viewer.userId,
    })
    await inngest.send({
      name: EVENTS.repoScanRequested,
      data: {
        repoScanId,
        repoId: owned.repo.id,
        installationId: owned.installationId,
        owner: owned.repo.owner,
        name: owned.repo.name,
        defaultBranch: owned.repo.defaultBranch,
        profile,
        requestedBy: viewer.userId,
      },
    })
    return NextResponse.json({ repoScanId, queued: true })
  } catch (error) {
    console.error('[api/repos/scan] could not enqueue the repo scan', error)
    return fail('Could not start the repo scan. Please try again in a moment.', 500)
  }
}
