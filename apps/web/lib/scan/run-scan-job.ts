/**
 * The seam between "somebody asked for a scan" and "a scan happened".
 *
 * This function knows nothing about HTTP. Today a route handler awaits it;
 * in Phase 5 an Inngest step will call the identical function while the route
 * returns immediately, and in Phase 7 the public API will call it too. That
 * swap is a change of caller, not a rewrite, which is the entire reason the
 * scan is not written inline in the route.
 *
 * It also does not throw for a scan that failed. An SSRF-blocked target, a
 * host that never answered, a TLS handshake that collapsed — those are
 * RESULTS. They are recorded on the scan and the id comes back, so the visitor
 * lands on a page that explains what happened instead of a 500. Throwing is
 * reserved for our own failures, such as the database being unreachable.
 */

import 'server-only'
import {
  allChecks,
  buildContext,
  computeScores,
  detectStack,
  ENGINE_VERSION,
  runChecks,
  SafeFetchError,
  SsrfError,
} from '@darvin/checks'
import {
  verifiedHostForProject,
  completeScan,
  createScan,
  failScan,
  type ScanContextMeta,
  type ScanProfile,
} from '@darvin/db'

/**
 * Optional. Absent means deep scans skip PageSpeed Insights entirely rather
 * than burning half a minute on a call that will be rate-limited. Get one from
 * the Google Cloud console with the PageSpeed Insights API enabled; the free
 * tier is 25,000 requests a day.
 */
const PAGESPEED_API_KEY = process.env['PAGESPEED_API_KEY']

export interface ScanRequest {
  /** Already normalized by lib/url.ts. This layer does not parse user input. */
  url: string
  profile: ScanProfile
  projectId?: string | null
  requestedBy?: string | null
  /** Already hashed by lib/request.ts. A raw address must never arrive here. */
  anonIpHash?: string | null
}

export async function runScanJob(request: ScanRequest): Promise<string> {
  const { id } = await createScan({
    url: request.url,
    profile: request.profile,
    engineVersion: ENGINE_VERSION,
    checksRun: allChecks.length,
    projectId: request.projectId ?? null,
    requestedBy: request.requestedBy ?? null,
    anonIpHash: request.anonIpHash ?? null,
  })

  const startedAt = performance.now()

  try {
    // Active backend probing is authorised by DATA, not by a flag the caller
    // passes: only a domain-verified project has a verified host at all, and
    // buildContext grants the capability only if the page we LAND on is that
    // host. A caller cannot opt itself in, and a redirect cannot smuggle
    // somebody else's site past the gate.
    const verifiedHost = await verifiedHostForProject(request.projectId)

    const ctx = await buildContext(request.url, {
      ...(verifiedHost ? { activeTesting: { verifiedHost } } : {}),
      // The one behavioural difference between the profiles: a deep scan
      // follows the page's own links, which multiplies the requests we make
      // against the target and is why the fast scan does not.
      crawl: request.profile === 'deep',
      // Only when a key is configured. Without one the call is a guaranteed
      // 429 — the anonymous quota is shared with every caller on the internet
      // — so attempting it would spend 30 s of a job's budget to learn nothing.
      ...(request.profile === 'deep' && PAGESPEED_API_KEY ? { pageSpeed: { apiKey: PAGESPEED_API_KEY } } : {}),
    })
    const { findings, errors } = await runChecks(ctx)
    const scores = computeScores(findings, allChecks, errors)

    // Detected once, at scan time, and stored — the aggregate fix prompt is
    // built later from the saved report, when the page's HTML is long gone.
    const stack = detectStack(ctx)

    const contextMeta: ScanContextMeta = {
      finalUrl: ctx.finalUrl.href,
      redirectChain: ctx.redirectChain,
      status: ctx.status,
      framework: stack.framework,
      platform: stack.platform,
      tlsExpiry: ctx.tls?.validTo.toISOString() ?? null,
    }

    await completeScan(id, {
      scores,
      findings,
      contextMeta,
      checkErrors: errors,
      durationMs: Math.round(performance.now() - startedAt),
    })
  } catch (error) {
    await failScan(id, describeFailure(error), Math.round(performance.now() - startedAt))
  }

  return id
}

/**
 * A sentence the visitor can act on, never an internal one.
 *
 * The engine's own errors already read as explanations, so they pass through.
 * Anything else is ours: it gets logged with its real message and the visitor
 * gets a neutral line, because an unexpected stack trace on a public page is
 * both useless to them and useful to somebody else.
 */
function describeFailure(error: unknown): string {
  // Passed through unwrapped. Both already read as complete sentences, and a
  // prefix would mislabel the commonest case: "Could not resolve hostname" is a
  // typo in the address, not a refusal to scan it.
  if (error instanceof SsrfError || error instanceof SafeFetchError) return error.message

  console.error('[run-scan-job] unexpected failure', error)
  return 'The scan stopped unexpectedly. This is a problem on our side, not with the site.'
}
