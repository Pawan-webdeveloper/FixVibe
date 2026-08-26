/**
 * The browser tier's client.
 *
 * `apps/scanner` runs headless Chromium and answers two questions the engine
 * cannot answer for itself: what the DOM looks like after JavaScript has run,
 * and what axe-core makes of the resulting accessibility tree. This module is
 * the only thing in the engine that talks to it.
 *
 * ## Everything here degrades to null
 *
 * The browser tier is a separate process, usually a separate host, and it is
 * the most failure-prone component in the system: browsers crash, pages hang,
 * a container gets OOM-killed. None of that may become a finding about the
 * customer's site. A null means "we did not look", and every check reading
 * `ctx.rendered` stays silent on it — the same rule as `probe()` returning
 * null and as a missing `activeProbe`.
 *
 * The service also reports PER-JOB failures, so a page whose Content-Security
 * -Policy defeated the audit still returns its DOM. A partial answer is used
 * for the parts that arrived and is silent about the rest.
 *
 * Requests go to a URL from our own configuration, not one derived from the
 * page under scan, so there is no SSRF surface here and plain `fetch` is
 * correct. The SSRF question belongs on the other side of this call, where a
 * real browser is pointed at a stranger's URL — see apps/scanner/src/guard.ts.
 */

import type { CheckContext } from '../types.ts'

export interface ScannerOptions {
  /** Base URL of the scanner service, e.g. "http://127.0.0.1:8080". */
  url: string
  /** Shared secret. The service refuses to start without one and 401s without a match. */
  token: string
  /**
   * Whole-call budget. Generous by default: the service itself allows a page
   * 20 s to load and 45 s in total, and a client that gives up first would
   * discard work that was about to succeed.
   */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 60_000

interface RenderResponse {
  content?: { html?: unknown; finalUrl?: unknown; title?: unknown }
  axe?: { violations?: unknown; passCount?: unknown }
  failed?: Record<string, unknown>
}

export async function fetchRendered(
  target: URL,
  options: ScannerOptions,
): Promise<CheckContext['rendered']> {
  try {
    const response = await fetch(`${options.url.replace(/\/$/, '')}/render`, {
      method: 'POST',
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.token}`,
        accept: 'application/json',
      },
      body: JSON.stringify({ url: target.href, jobs: ['content', 'axe'] }),
    })
    // 401 (misconfigured token), 503 (busy) and 502 (the page would not
    // render) are all "no data", not "the site is broken".
    if (!response.ok) return null

    return summarize((await response.json()) as RenderResponse)
  } catch {
    return null
  }
}

function summarize(body: RenderResponse): CheckContext['rendered'] {
  const html = typeof body.content?.html === 'string' ? body.content.html : ''
  const axe = summarizeAxe(body.axe)

  // Nothing usable came back. Reporting an empty render as a finding would be
  // reporting our own outage as the customer's problem.
  if (html === '' && axe === null) return null

  return {
    html,
    finalUrl: typeof body.content?.finalUrl === 'string' ? body.content.finalUrl : '',
    axe,
  }
}

function summarizeAxe(raw: RenderResponse['axe']): NonNullable<CheckContext['rendered']>['axe'] {
  if (!raw || !Array.isArray(raw.violations)) return null

  const violations = raw.violations
    .map((violation) => {
      const entry = violation as Record<string, unknown>
      const id = typeof entry['id'] === 'string' ? entry['id'] : ''
      if (id === '') return null
      return {
        id,
        impact: impactOf(entry['impact']),
        help: str(entry['help']),
        helpUrl: str(entry['helpUrl']),
        description: str(entry['description']),
        tags: Array.isArray(entry['tags']) ? entry['tags'].filter((tag): tag is string => typeof tag === 'string') : [],
        nodeCount: typeof entry['nodeCount'] === 'number' ? entry['nodeCount'] : 0,
        samples: Array.isArray(entry['samples'])
          ? entry['samples'].map((sample) => {
              const node = sample as Record<string, unknown>
              return { target: str(node['target']), html: str(node['html']) }
            })
          : [],
      }
    })
    .filter((violation): violation is NonNullable<typeof violation> => violation !== null)

  return { violations, passCount: typeof raw.passCount === 'number' ? raw.passCount : 0 }
}

const IMPACTS = new Set(['critical', 'serious', 'moderate', 'minor'])

function impactOf(value: unknown): 'critical' | 'serious' | 'moderate' | 'minor' | null {
  return typeof value === 'string' && IMPACTS.has(value) ? (value as 'critical') : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
