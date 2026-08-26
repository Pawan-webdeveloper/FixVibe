/**
 * GET /api/v1/projects — the caller's projects, newest first.
 *
 * Exists because a machine cannot use the rest of this API without it. A scan
 * is attached to a project by id, and depth-unlocking checks depend on that
 * project being domain-verified — so an agent holding only a key has no way to
 * name either without asking. This is the discovery endpoint.
 *
 * `delta` is null whenever the two scans are not comparable — a different
 * engine version or scan depth means the ruler changed, not the site. That
 * matters more here than on the dashboard: a human reading "-6" next to a
 * caveat understands it, and an agent reading a bare number does not.
 */

import { NextResponse } from 'next/server'
import { listProjectSummaries } from '@darvin/db'
import { authenticateApiRequest } from '@/lib/api-auth.ts'
import { apiError, scanPath } from '@/lib/api-response.ts'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request)
  if (!auth.ok) return apiError(auth.status === 401 ? 'unauthorized' : 'forbidden', auth.error, auth.status)

  const summaries = await listProjectSummaries(auth.principal.viewer)

  return NextResponse.json({
    projects: summaries.map(({ project, latest, delta }) => ({
      id: project.id,
      name: project.name,
      url: project.url,
      slug: project.slug,
      /**
       * Reported because it decides what a scan of this project can measure:
       * the two backend checks run only for a domain whose operator proved it
       * is theirs. An agent told a project is unverified can say WHY two
       * checks are missing instead of reporting them as passes.
       */
      verifiedDomain: project.verifiedDomain,
      latestScan: latest
        ? {
            id: latest.id,
            status: latest.status,
            profile: latest.profile,
            overall: latest.scores?.overall ?? null,
            createdAt: latest.createdAt.toISOString(),
            links: { self: scanPath(latest.id) },
          }
        : null,
      /** Null when the previous scan is not comparable. Never coerce it to 0. */
      overallDelta: delta,
    })),
  })
}
