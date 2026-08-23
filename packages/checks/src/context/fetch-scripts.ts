/**
 * Fetching the bodies of the scripts a page loads.
 *
 * Two checks need the actual JavaScript rather than its URL: secrets-in-JS,
 * which looks for credentials compiled into a bundle, and source-maps, which
 * reads the `sourceMappingURL` comment browsers use to find the original code.
 * Neither can say anything about a URL alone.
 *
 * THIS IS AN SSRF SURFACE and it is worth being explicit about why it is safe.
 * Script URLs come from the scanned page, so they are attacker controlled — a
 * hostile page can point at anything. Every fetch goes through safeFetch, which
 * calls assertSafeUrl on the initial URL AND on every redirect hop, so a script
 * tag aimed at 169.254.169.254, or one that redirects there after two hops, is
 * refused exactly as the page fetch would be.
 *
 * Which scripts get read is a priority order, not a filter, and that distinction
 * was learned the hard way: an earlier version only fetched scripts on the
 * page's own registrable domain, which read ZERO bytes on both stripe.com and
 * github.com. Serving your bundle from a separate asset domain — stripecdn.com,
 * githubassets.com — is normal practice, so an allowlist built on the page's own
 * domain excludes exactly the files worth reading. Instead: skip the handful of
 * hosts that are certainly somebody else's product, then prefer the page's own
 * origin, then take what fits in the budget.
 */

import type { CheckContext } from '../types.ts'
import { safeFetch } from './safe-fetch.ts'

type Script = CheckContext['scripts'][number]

/** Enough to reach a main bundle and a chunk or two without turning a scan into a download. */
const MAX_SCRIPTS = 6
const MAX_BYTES_PER_SCRIPT = 512 * 1024
const TIMEOUT_MS = 8_000
const CONCURRENCY = 3

/**
 * Hosts whose files are a vendor's product rather than this site's build. Their
 * bundles will never contain this site's secrets, and downloading them on every
 * scan is pointless traffic aimed at somebody who did not ask for it.
 *
 * Deliberately short. A host missing from this list costs one wasted fetch; a
 * host wrongly on it costs a check its evidence, which is the worse error.
 */
const THIRD_PARTY_HOSTS = [
  'google-analytics.com',
  'googletagmanager.com',
  'googlesyndication.com',
  'doubleclick.net',
  'facebook.net',
  'connect.facebook.com',
  'hotjar.com',
  'segment.com',
  'segment.io',
  'intercom.io',
  'intercomcdn.com',
  'mixpanel.com',
  'amplitude.com',
  'fullstory.com',
  'clarity.ms',
  'newrelic.com',
  'nr-data.net',
  'cloudflareinsights.com',
  'zdassets.com',
  'usercentrics.eu',
]

function isThirdParty(host: string): boolean {
  return THIRD_PARTY_HOSTS.some((vendor) => host === vendor || host.endsWith(`.${vendor}`))
}

/** Same host, or a host sharing the last two labels — the assets./cdn. case. */
function sameSite(host: string, pageHost: string): boolean {
  if (host === pageHost) return true
  const tail = (name: string) => name.split('.').slice(-2).join('.')
  return tail(host) === tail(pageHost)
}

/**
 * Which script URLs are worth reading, best first. Pure and exported so the
 * selection — the part that had the bug — is testable without a network.
 */
export function selectScripts(scripts: readonly Script[], finalUrl: URL, limit = MAX_SCRIPTS): string[] {
  const pageHost = finalUrl.hostname.toLowerCase()
  const seen = new Set<string>()
  const ranked: Array<{ url: string; rank: number }> = []

  for (const script of scripts) {
    if (!script.url || seen.has(script.url)) continue

    let host: string
    try {
      host = new URL(script.url).hostname.toLowerCase()
    } catch {
      continue
    }
    if (isThirdParty(host)) continue

    seen.add(script.url)
    // Same origin first, then the site's own asset domain, then everything
    // else — so a tight budget is spent on the files most likely to be theirs.
    ranked.push({ url: script.url, rank: host === pageHost ? 0 : sameSite(host, pageHost) ? 1 : 2 })
  }

  return ranked
    .map((entry, index) => ({ ...entry, index }))
    // Stable within a rank, so two scans of one site read the same files.
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.url)
}

export async function fetchScriptBodies(scripts: Script[], finalUrl: URL): Promise<Script[]> {
  const queue = selectScripts(scripts, finalUrl)
  if (queue.length === 0) return scripts

  const fetched = new Map<string, string>()

  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      try {
        const response = await safeFetch(url, {
          timeoutMs: TIMEOUT_MS,
          maxBodyBytes: MAX_BYTES_PER_SCRIPT,
        })
        // A 200 that is HTML is a catch-all route, not JavaScript; scanning the
        // app shell for secrets would only produce noise.
        if (response.status === 200 && !/^\s*<(!doctype|html)\b/i.test(response.body)) {
          fetched.set(url, response.body)
        }
      } catch {
        // Blocked by the SSRF guard, unreachable, or too slow. A script we
        // could not read is simply one those checks say nothing about.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))

  return scripts.map((script) =>
    script.url && fetched.has(script.url) ? { ...script, content: fetched.get(script.url)! } : script,
  )
}
