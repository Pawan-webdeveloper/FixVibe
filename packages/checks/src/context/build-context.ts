/**
 * buildContext — the single data-gathering pass of a scan.
 *
 * Ordering matters: the page fetch comes first (it decides the final URL),
 * then TLS / DNS / robots / http-probe run concurrently against that final
 * host. Each side channel degrades to null/empty on failure — a scan only
 * aborts when the page itself is unreachable or the target is SSRF-blocked.
 */

import type { CheckContext } from '../types.ts'
import { assertSafeUrl } from './ssrf-guard.ts'
import { safeFetch } from './safe-fetch.ts'
import { parseHtml } from './parse-html.ts'
import { fetchScriptBodies } from './fetch-scripts.ts'
import { parseSetCookies } from './cookies.ts'
import { getTlsInfo } from './tls.ts'
import { getDnsInfo } from './dns.ts'
import { fetchRobots } from './robots.ts'
import { crawlSite } from './crawl.ts'
import { fetchPageSpeed, type PageSpeedOptions } from './psi.ts'

export interface BuildContextOptions {
  /** Budget for the main page fetch (side channels have their own, shorter ones). */
  timeoutMs?: number
  /**
   * Whether this scan may test the target's backends actively — reaching the
   * Supabase project or Firebase database the page's own JavaScript talks to.
   *
   * Only ever true when the requester has proved they control the domain.
   * Passing it turns on `ctx.activeProbe`; leaving it off means the checks
   * that need it are not merely disabled but structurally unable to run,
   * because the function they would call is not on the context.
   */
  activeTesting?: boolean
  /**
   * Whether to follow the page's own same-origin links (the `deep` profile).
   *
   * Off by default because it multiplies the requests a scan makes against the
   * target: a fast scan stays one page plus a handful of probes, which is what
   * makes the landing page's "paste a URL" flow answer in about a second.
   */
  crawl?: boolean
  /**
   * Fetch PageSpeed Insights for the final URL. Presence means "do it"; the
   * apiKey inside is all but required, since the keyless quota is shared with
   * every anonymous caller on the internet and is usually spent.
   *
   * Expensive in wall-clock terms: a PSI call runs Lighthouse server-side and
   * takes 15-30 seconds, more than the rest of a scan by an order of
   * magnitude. Deep, background scans only.
   */
  pageSpeed?: PageSpeedOptions
}

/** Politeness cap: total extra same-origin requests all checks may make combined. */
const MAX_PROBES_PER_SCAN = 24
const PROBE_MAX_BODY_BYTES = 256 * 1024

/**
 * Active probes are capped far lower than same-origin ones. They are
 * authenticated requests against a third party's API (Supabase, Firebase), and
 * a scanner that issues dozens of them looks like an attack to whoever reads
 * those logs — even when the customer authorised it.
 */
const MAX_ACTIVE_PROBES_PER_SCAN = 12
/** Enough for a PostgREST OpenAPI document on a large project. */
const ACTIVE_PROBE_MAX_BODY_BYTES = 1024 * 1024

const EMPTY_DNS: CheckContext['dns'] = {
  txt: [],
  caa: null,
  mx: [],
  emailDomain: null,
  spfTxt: [],
  dmarcTxt: [],
  dkim: { selectors: {}, wildcard: null },
  registration: null,
}

export async function buildContext(
  target: URL | string,
  options: BuildContextOptions = {},
): Promise<CheckContext> {
  const url = new URL(target)
  assertSafeUrl(url) // fail fast with a clear message before any network I/O

  const page = await safeFetch(url, { timeoutMs: options.timeoutMs })
  const { finalUrl } = page

  const { $, scripts: referenced } = parseHtml(page.body, finalUrl)
  // External script bodies are fetched so secrets-in-JS and source-maps have
  // something to read. Bounded and SSRF-guarded — see fetch-scripts.ts.
  const scripts = await fetchScriptBodies(referenced, finalUrl)
  const cookies = parseSetCookies(page.headers)

  const isHttps = finalUrl.protocol === 'https:'
  const tlsPort = finalUrl.port ? Number(finalUrl.port) : 443

  // If the user gave us an https URL we never saw port 80 — probe it once so
  // the https-redirect check can verify the upgrade instead of guessing.
  // (An http input that upgraded already proves itself via redirectChain.)
  // Default port only: for https://host:8443 there is no reason to believe
  // port 80 belongs to the same site, and judging an unrelated listener would
  // produce a false high-severity finding.
  const wantsHttpProbe = isHttps && url.protocol === 'https:' && finalUrl.port === ''

  // Started here and awaited at the very end: a PSI run takes 15-30 seconds,
  // so it overlaps the side channels AND the crawl instead of being added to
  // them. Not inside the Promise.all below, which the crawl waits on.
  const pageSpeedPromise = options.pageSpeed ? fetchPageSpeed(finalUrl, options.pageSpeed) : undefined

  const [tls, dns, robots, httpProbe] = await Promise.all([
    isHttps ? getTlsInfo(finalUrl.hostname, tlsPort) : Promise.resolve(null),
    getDnsInfo(finalUrl.hostname).catch(() => EMPTY_DNS),
    fetchRobots(finalUrl.origin),
    wantsHttpProbe ? probeHttpVariant(finalUrl.hostname) : Promise.resolve(null),
  ])

  // After robots: the crawl consults it, and after the page fetch: it follows
  // links found in that document. Sequential on purpose, not an oversight.
  const crawl = options.crawl ? await crawlSite($, finalUrl, robots) : undefined
  const pageSpeed = pageSpeedPromise ? await pageSpeedPromise : undefined

  return {
    url,
    finalUrl,
    redirectChain: page.redirectChain,
    status: page.status,
    headers: page.headers,
    html: page.body,
    $,
    scripts,
    cookies,
    tls,
    dns,
    robots,
    httpProbe,
    probe: makeProbe(finalUrl.origin),
    ...(crawl ? { crawl } : {}),
    ...(pageSpeedPromise ? { pageSpeed } : {}),
    // Deliberately conditional: an unauthorised scan does not get a disabled
    // capability, it gets no capability. See CheckContext.activeProbe.
    ...(options.activeTesting ? { activeProbe: makeActiveProbe() } : {}),
  }
}

/** First response of http://host/ — status + Location, body discarded. */
async function probeHttpVariant(hostname: string): Promise<CheckContext['httpProbe']> {
  try {
    const response = await safeFetch(`http://${hostname}/`, {
      followRedirects: false,
      timeoutMs: 6_000,
      maxBodyBytes: 4 * 1024,
    })
    return { status: response.status, location: response.headers.get('location') }
  } catch {
    return null // port 80 closed / filtered — nothing to report on
  }
}

/**
 * The context's `activeProbe()`: any origin, memoised per url+headers, capped
 * hard. Handed out only when the caller passed `activeTesting`.
 *
 * Still routed through safeFetch, so `assertSafeUrl` runs on the url and on
 * every redirect hop. "The user authorised us to test their backend" is not a
 * reason to let a redirect walk us into 169.254.169.254.
 */
function makeActiveProbe(): NonNullable<CheckContext['activeProbe']> {
  const cache = new Map<string, ReturnType<NonNullable<CheckContext['activeProbe']>>>()
  let remaining = MAX_ACTIVE_PROBES_PER_SCAN

  return (url, init) => {
    // Headers are part of the key: the same url with a different API key is a
    // different question, and answering the second from the first would lie.
    const key = `${url}\u0000${JSON.stringify(init?.headers ?? {})}`
    const cached = cache.get(key)
    if (cached) return cached

    if (remaining <= 0) return Promise.resolve(null)
    remaining -= 1

    const result = safeFetch(url, {
      timeoutMs: 8_000,
      maxBodyBytes: ACTIVE_PROBE_MAX_BODY_BYTES,
      headers: init?.headers,
    }).then(
      (response) => ({ status: response.status, body: response.body, headers: response.headers }),
      () => null,
    )
    cache.set(key, result)
    return result
  }
}

/**
 * The context's `probe()`: same-origin only, memoised per path (two checks
 * probing "/.well-known/security.txt" cost one request), globally capped so a
 * scan stays polite no matter how many checks use it.
 */
function makeProbe(origin: string): CheckContext['probe'] {
  const cache = new Map<string, ReturnType<CheckContext['probe']>>()
  let remaining = MAX_PROBES_PER_SCAN

  return (path) => {
    const cached = cache.get(path)
    if (cached) return cached

    if (remaining <= 0) return Promise.resolve(null)
    remaining -= 1

    const result = safeFetch(new URL(path, origin), {
      timeoutMs: 8_000,
      maxBodyBytes: PROBE_MAX_BODY_BYTES,
    }).then(
      (response) => ({ status: response.status, body: response.body, headers: response.headers }),
      () => null,
    )
    cache.set(path, result)
    return result
  }
}
