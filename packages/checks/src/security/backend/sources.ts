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

/**
 * Every text blob a scan has that could carry backend configuration: the HTML
 * (Next.js `__NEXT_DATA__`, Vite `import.meta.env` shims, plain inline
 * scripts) and the body of each script the context managed to read.
 *
 * Script URLs are included too. A bundle on a CDN the context could not fetch
 * still contributes its own filename, which is occasionally where a project
 * ref appears.
 */
export function sources(ctx: CheckContext): string[] {
  const texts = [ctx.html]
  for (const script of ctx.scripts) {
    if (script.content) texts.push(script.content)
    if (script.url) texts.push(script.url)
  }
  return texts
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
