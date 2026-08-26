/**
 * Whether fingerprinted assets are cached for as long as they safely can be.
 *
 * A filename carrying a content hash — app-a3f9c2e1.js — changes whenever its
 * contents change, which makes it safe to cache forever. Serving one with a
 * short max-age means every returning visitor re-downloads a file that could
 * not possibly have changed, and the site pays for it in bandwidth as well as
 * in load time.
 *
 * Scoped to hashed filenames on purpose. A short max-age on /style.css is
 * CORRECT — that URL's contents do change, and telling someone to cache it for
 * a year would be advice that eventually serves stale code to every visitor.
 * The check only speaks where the answer is unambiguous.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'performance.caching-headers'

/** A content hash: a long hex or base-36 run before the extension. */
const FINGERPRINTED = /[.\-_][a-f0-9]{8,}\.(?:js|css|woff2?|png|jpe?g|svg|webp|avif)$/i

/** Below a week there is no point having fingerprinted the file at all. */
const MIN_SAFE_MAX_AGE = 7 * 24 * 60 * 60

export const cachingHeadersCheck: Check = {
  id: ID,
  category: 'performance',
  title: 'Asset caching',

  async run(ctx) {
    const candidate = [
      ...ctx.$('script[src]').toArray().map((el) => ctx.$(el).attr('src')),
      ...ctx.$('link[rel="stylesheet"][href]').toArray().map((el) => ctx.$(el).attr('href')),
    ]
      .flatMap((raw) => {
        if (!raw) return []
        try {
          const url = new URL(raw, ctx.finalUrl)
          return url.origin === ctx.finalUrl.origin && FINGERPRINTED.test(url.pathname) ? [url] : []
        } catch {
          return []
        }
      })[0]

    // No fingerprinted same-origin asset means nothing here is decidable.
    if (!candidate) return []

    const response = await ctx.probe(`${candidate.pathname}${candidate.search}`)
    if (response?.status !== 200) return []

    const cacheControl = response.headers.get('cache-control')
    const maxAge = Number(/max-age\s*=\s*(\d+)/i.exec(cacheControl ?? '')?.[1] ?? NaN)
    const immutable = /\bimmutable\b/i.test(cacheControl ?? '')

    if (Number.isFinite(maxAge) && maxAge >= MIN_SAFE_MAX_AGE) return []

    const url = candidate.href

    return [
      {
        checkId: ID,
        category: 'performance',
        severity: 'low',
        title: 'Fingerprinted assets are not cached long',
        description:
          `${url} carries a content hash in its filename, so its contents can never change without ` +
          `the URL changing too — and it is served with ` +
          (cacheControl ? `"Cache-Control: ${cacheControl}"` : 'no Cache-Control header at all') +
          '. Every returning visitor re-requests a file that is provably identical to the one they ' +
          'already have.',
        evidence: { asset: url, cacheControl, maxAge: Number.isFinite(maxAge) ? maxAge : null, immutable },
        remediation: 'Serve hashed assets with `Cache-Control: public, max-age=31536000, immutable`.',
        fixPrompt:
          `Assets like ${url} on this site are fingerprinted but not cached long. Serve any path whose ` +
          'filename contains a content hash with `Cache-Control: public, max-age=31536000, immutable` ' +
          '— a year, and `immutable` so browsers skip revalidation entirely. Apply it by path pattern ' +
          '(the build output directory) rather than per file, and leave HTML on a short max-age: the ' +
          'document is the thing that must stay fresh so it can point at the new hashes.',
      } satisfies Finding,
    ]
  },
}
