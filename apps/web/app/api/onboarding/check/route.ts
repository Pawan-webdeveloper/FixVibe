/**
 * apps/web/app/api/onboarding/check/route.ts
 *
 * POST /api/onboarding/check
 *
 * Runs the four onboarding checks against a URL — uptime probe, SSL,
 * domain expiry, and PSI / web vitals — in parallel and returns the
 * combined result. Used by the /onboarding wizard to show the user a
 * one-shot picture of their site BEFORE they commit to a project.
 *
 * ## Why one endpoint, four checks
 *
 * The wizard needs all four results at once to render the scorecard.
 * Splitting into four round trips would mean the user sees each row
 * populate one at a time, which is what the design calls for — but the
 * network layer should not pay four times when the server can fan out
 * internally for the same cost as one. We return a single JSON payload
 * and let the client animate the rows in as it sees them.
 *
 * ## What is NOT here
 *
 * - No DB writes. The checks are read-only; the user has not committed
 *   to creating a project yet.
 * - No rate limit at the wizard level. The user runs this exactly once
 *   during onboarding; an abusive retry is a sign of a bot, not a user,
 *   and the global Inngest rate limit / IP hash covers that path.
 * - No PSI cache lookup — the PSI cache lives at the project level
 *   (Phase 6.x). The onboarding call is one-shot; caching it would
 *   add complexity without saving anything.
 *
 * ## Auth
 *
 * Authenticated. The wizard lives under (app) which is signed-in only;
 * the route is not anonymous. We re-check viewer.kind here rather than
 * trusting the layout, because server actions and routes can be hit
 * directly.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { checkDomain, checkSsl, checkWebVitals, safeFetch } from '@scanlyfix/checks'
import { normalizeScanTarget } from '@/lib/url.ts'
import { getViewer } from '@/lib/authz.ts'

export const runtime = 'nodejs'

const BodySchema = z.object({
  url: z.string().min(1).max(2048),
})

const PROBE_TIMEOUT_MS = 10_000

interface OnboardingCheckPayload {
  url: string
  hostname: string
  uptime: UptimeCheck
  ssl: SslCheck
  domain: DomainCheck
  webVitals: WebVitalsCheck
}

interface UptimeCheck {
  status: 'up' | 'down' | 'timeout' | 'error'
  latencyMs: number | null
  statusCode: number | null
  detail: string | null
}

interface SslCheck {
  ok: boolean
  daysUntilExpiry: number | null
  expiresAt: string | null
  detail: string | null
}

interface DomainCheck {
  ok: boolean
  daysUntilExpiry: number | null
  expiresAt: string | null
  detail: string | null
}

interface WebVitalsCheck {
  ok: boolean
  lcp: number | null
  cls: number | null
  detail: string | null
}

export async function POST(request: Request) {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  // Re-use the same normalizer the scan page uses. Both the client and
  // server run this — the API re-runs it because nothing on the wire is
  // trusted. Throws if the input is unparseable; the zod parse above has
  // already filtered obviously-empty input.
  const target = normalizeScanTarget(parsed.data.url)
  if (!target.ok) {
    return NextResponse.json({ error: target.reason }, { status: 400 })
  }

  const hostname = target.hostname

  // Run the four checks in parallel. safeFetch does the SSRF guard
  // (private IP, localhost, cloud metadata) — the wizard runs against
  // a hostname the user typed, so the same guard applies here as on
  // the scan path. Each call returns a non-throwing shape so one
  // failing check does not sink the others.
  const [uptime, ssl, domain, webVitals] = await Promise.all([
    runUptimeProbe(target.url),
    Promise.resolve().then(() => checkSsl(hostname)),
    Promise.resolve().then(() => checkDomain(hostname)),
    Promise.resolve()
      .then(() => checkWebVitals(target.url))
      .catch(
        (error): WebVitalsCheck => ({
          ok: false,
          lcp: null,
          cls: null,
          detail: error instanceof Error ? error.message : 'Web vitals check failed',
        }),
      ),
  ])

  return NextResponse.json({
    url: target.url,
    hostname,
    uptime,
    ssl,
    domain,
    webVitals,
  } satisfies OnboardingCheckPayload)
}

/**
 * A one-shot HTTP probe — the same shape the uptime monitor uses, but
 * no DB writes and no recordMonitorRun. We do not import the Inngest
 * probe because that worker is designed to be batched and persistent;
 * a wizard click wants an immediate answer.
 *
 * Returns a `UptimeCheck` with the status the scorecard can render.
 */
async function runUptimeProbe(url: string): Promise<UptimeCheck> {
  const startedAt = Date.now()
  try {
    const response = await safeFetch(url, { timeoutMs: PROBE_TIMEOUT_MS, maxBodyBytes: 4096 })
    const latencyMs = Date.now() - startedAt
    return {
      status: response.status >= 500 ? 'down' : 'up',
      latencyMs,
      statusCode: response.status,
      detail: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // safeFetch throws SafeFetchError on network/timeout; the message is
    // enough to tell the user what failed without leaking internal shapes.
    const isTimeout = /timeout|aborted/i.test(message)
    return {
      status: isTimeout ? 'timeout' : 'error',
      latencyMs: null,
      statusCode: null,
      detail: message,
    }
  }
}
