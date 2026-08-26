/**
 * Where the backend checks look for configuration.
 *
 * A single-page app hands its browser everything it needs to reach its
 * backend: the project URL and the public API key are compiled into the
 * bundle, or inlined into the HTML as a build-time environment blob. That is
 * by design — those values are meant to be public, and the backend's own
 * authorization rules are what protect the data behind them.
 *
 * So finding a key here is never itself a finding. It only tells us which
 * backend to ask whether those rules are actually switched on.
 */

import type { CheckContext } from '../../types.ts'
import { organizationalDomain } from '../../context/public-suffix.ts'

/**
 * Every text blob that could carry THIS SITE'S backend configuration: the HTML
 * (Next.js `__NEXT_DATA__`, Vite `import.meta.env` shims, plain inline
 * scripts) and the body of each script that belongs to the site itself.
 *
 * ## Third-party bundles are excluded, and that exclusion is load-bearing
 *
 * The context fetches script bodies from other origins too, because
 * secrets-in-JS and source-maps have good reasons to read them. The backend
 * checks must not, because what they find there is used as a PROBE TARGET.
 *
 * A customer embeds `https://widget.somevendor.io/embed.js`. That bundle
 * contains the vendor's own Supabase URL and publishable key — as every
 * Supabase-backed widget must. Reading it here would point the active checks
 * at the VENDOR's database on a scan of the customer's site: unauthorised
 * testing against a company that never consented, and the vendor's table and
 * column names written into a report the customer can share. No attacker is
 * required; an ordinary embed does it.
 *
 * Same registrable domain rather than same origin, so a site's own
 * `cdn.example.com` or `assets.example.com` still counts. When the
 * organizational domain cannot be derived without a Public Suffix List, only
 * exact host matches are accepted — under-reading is recoverable.
 */
export function sources(ctx: CheckContext): string[] {
  const texts = [ctx.html]

  for (const script of ctx.scripts) {
    // Inline scripts carry no url and are unambiguously the page's own.
    if (!script.url) {
      if (script.content) texts.push(script.content)
      continue
    }
    if (!belongsToSite(script.url, ctx.finalUrl)) continue
    if (script.content) texts.push(script.content)
    texts.push(script.url)
  }

  return texts
}

/** Whether a script URL is served by the scanned site rather than a third party. */
function belongsToSite(scriptUrl: string, pageUrl: URL): boolean {
  let host: string
  try {
    host = new URL(scriptUrl).hostname
  } catch {
    return false
  }
  if (host.toLowerCase() === pageUrl.hostname.toLowerCase()) return true

  const site = organizationalDomain(pageUrl.hostname)
  // Null means we could not determine the registrable domain, and guessing one
  // here would re-open the exact hole this function exists to close.
  if (site === null) return false

  // A subdomain suffix test, not organizationalDomain() on both sides: that
  // function returns null for anything deeper than one label under the
  // registrable domain, so `assets.site.test` would not have matched
  // `site.test` and a site's own CDN would have been treated as a stranger.
  // The leading dot is what makes this safe — `site.test.evil.com` does not
  // end with `.site.test`.
  const target = host.toLowerCase()
  return target === site || target.endsWith(`.${site}`)
}

/** First capture group of every match across every source, deduplicated, in order. */
export function collect(texts: readonly string[], pattern: RegExp, group = 1): string[] {
  const found = new Set<string>()
  for (const text of texts) {
    // Fresh lastIndex per source: a /g regex reused across strings silently
    // skips matches near the start of the next one.
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))) {
      const value = match[group]
      if (value) found.add(value)
    }
  }
  return [...found]
}
