/**
 * PageSpeed Insights — the one thing a scanner cannot measure for itself.
 *
 * Every performance check in this engine so far reasons about what the
 * response headers and markup make possible: compression is on, caching is
 * sane, images are not all PNG. None of that is a measurement. How long the
 * page actually takes to become useful depends on the device, the network and
 * the rest of the page's JavaScript, and the only honest source for it is
 * Chrome's own field data.
 *
 * PSI returns two different things and they are not interchangeable:
 *
 *   FIELD (CrUX) — the 75th percentile of what real Chrome users on real
 *     devices experienced over the last 28 days. This is what Google uses as a
 *     ranking signal and it is the number that matters. It exists only for
 *     URLs with enough traffic; most sites have none, and for them this is
 *     null and the checks say nothing.
 *
 *   LAB (Lighthouse) — one simulated load on a throttled mid-range phone in a
 *     Google data centre. Reproducible and useful for diagnosis, but it is a
 *     model of a user, not a user. Anything reported from it has to say so.
 *
 * ## Cost and why this is opt-in
 *
 * A PSI call runs Lighthouse server-side and routinely takes 15–30 seconds —
 * an order of magnitude more than the entire rest of a scan. Without an API
 * key the shared anonymous quota is exhausted for most of every day (the
 * public endpoint answers 429), so in practice it needs a free key from the
 * Google Cloud console with the PageSpeed Insights API enabled.
 *
 * Everything degrades to null: no key, exhausted quota, a URL Google will not
 * fetch, a timeout, a shape we do not recognise. A null tells the checks we
 * did not measure, which is different from measuring something bad.
 */

import type { CheckContext } from '../types.ts'

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

/** Lighthouse genuinely takes this long. A shorter budget just guarantees nulls. */
const TIMEOUT_MS = 60_000

export interface PageSpeedOptions {
  /**
   * Google API key with the PageSpeed Insights API enabled. Optional, and
   * almost always necessary: the keyless quota is shared across every
   * anonymous caller on the internet and is usually spent.
   */
  apiKey?: string
}

/**
 * Fetched directly rather than through safeFetch: the host is a fixed Google
 * endpoint, not a URL derived from the page under scan, so there is no SSRF
 * surface to guard — and safeFetch's private-address rejection would be
 * answering a question nobody asked.
 */
export async function fetchPageSpeed(
  target: URL,
  options: PageSpeedOptions = {},
): Promise<CheckContext['pageSpeed']> {
  const query = new URLSearchParams({ url: target.href, strategy: 'mobile', category: 'performance' })
  if (options.apiKey) query.set('key', options.apiKey)

  try {
    const response = await fetch(`${ENDPOINT}?${query}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    // 429 (quota spent) and 400 (Google could not fetch the page) are both
    // "no measurement", not "the page is slow".
    if (!response.ok) return null

    return summarize((await response.json()) as PsiResponse)
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------- */
/* Response shape                                                             */
/* -------------------------------------------------------------------------- */

interface PsiMetric {
  percentile?: unknown
  category?: unknown
}

interface PsiLoadingExperience {
  metrics?: Record<string, PsiMetric>
  origin_fallback?: unknown
}

interface PsiResponse {
  loadingExperience?: PsiLoadingExperience
  originLoadingExperience?: PsiLoadingExperience
  lighthouseResult?: {
    categories?: { performance?: { score?: unknown } }
    audits?: Record<string, { numericValue?: unknown }>
  }
}

function summarize(body: PsiResponse): CheckContext['pageSpeed'] {
  const audits = body.lighthouseResult?.audits ?? {}
  const rawScore = body.lighthouseResult?.categories?.performance?.score

  const lab = {
    lcpMs: numericAudit(audits, 'largest-contentful-paint'),
    cls: numericAudit(audits, 'cumulative-layout-shift'),
    tbtMs: numericAudit(audits, 'total-blocking-time'),
  }

  return {
    strategy: 'mobile',
    // Lighthouse reports 0–1; a report showing "0.42" where every other score
    // is out of 100 is a support ticket waiting to happen.
    labScore: typeof rawScore === 'number' ? Math.round(rawScore * 100) : null,
    field: fieldMetrics(body),
    lab: lab.lcpMs === null && lab.cls === null && lab.tbtMs === null ? null : lab,
  }
}

/**
 * Real-user metrics, preferring this URL's own data over the origin's.
 *
 * `origin_fallback` is Google telling us the URL had too little traffic and it
 * substituted site-wide numbers. That is still worth reporting, but it
 * describes the site rather than this page, so the scope travels with the data
 * and the checks say which one they are talking about.
 */
function fieldMetrics(body: PsiResponse): NonNullable<CheckContext['pageSpeed']>['field'] {
  const urlLevel = body.loadingExperience
  const isFallback = urlLevel?.origin_fallback === true
  const source = isFallback ? (body.originLoadingExperience ?? urlLevel) : urlLevel

  const metrics = source?.metrics
  if (!metrics) return null

  const lcpMs = percentile(metrics['LARGEST_CONTENTFUL_PAINT_MS'])
  const inpMs = percentile(metrics['INTERACTION_TO_NEXT_PAINT'])
  const clsRaw = percentile(metrics['CUMULATIVE_LAYOUT_SHIFT_SCORE'])
  if (lcpMs === null && inpMs === null && clsRaw === null) return null

  return {
    lcpMs,
    inpMs,
    // CrUX reports CLS as an integer scaled by 100 — a percentile of 5 is a
    // CLS of 0.05. Reporting it unscaled would put every site on earth fifty
    // times over the 0.1 threshold.
    cls: clsRaw === null ? null : clsRaw / 100,
    scope: isFallback ? 'origin' : 'url',
  }
}

/** A metric's 75th-percentile value, or null when it is absent or not a number. */
function percentile(metric: PsiMetric | undefined): number | null {
  const value = metric?.percentile
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function numericAudit(audits: Record<string, { numericValue?: unknown }>, id: string): number | null {
  const value = audits[id]?.numericValue
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
