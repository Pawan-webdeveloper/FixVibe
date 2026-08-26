/**
 * A directory that hands back its contents instead of a page.
 *
 * Autoindex turns "you need to know the filename" into "here is every
 * filename" — build artefacts, old backups, editor swap files, the upload
 * directory. It is rarely intended on a production site and is usually a
 * default nobody turned off.
 *
 * The directory probed is derived from an asset the page ACTUALLY loads rather
 * than guessed from a list of common names. One request, aimed somewhere that
 * certainly exists, instead of six aimed at places that probably do not.
 */

import type { Check, Finding } from '../../types.ts'

const ID = 'security.exposure.directory-listing'

/** The title and heading every common autoindex emits. */
const LISTING_SIGNATURES = [/<title>\s*Index of /i, /<h1>\s*Index of /i, /Directory listing for /i]

export const directoryListingCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Directory listing',

  async run(ctx) {
    const assets = [
      ...ctx.$('script[src]').toArray().map((el) => ctx.$(el).attr('src')),
      ...ctx.$('link[href]').toArray().map((el) => ctx.$(el).attr('href')),
      ...ctx.$('img[src]').toArray().map((el) => ctx.$(el).attr('src')),
    ]

    for (const raw of assets) {
      if (!raw) continue
      let asset: URL
      try {
        asset = new URL(raw, ctx.finalUrl)
      } catch {
        continue
      }
      if (asset.origin !== ctx.finalUrl.origin) continue

      const directory = asset.pathname.replace(/[^/]*$/, '')
      if (directory === '/' || directory === '') continue // the root is the site itself

      const response = await ctx.probe(directory)
      if (response?.status !== 200) return [] // one probe, spent
      if (!LISTING_SIGNATURES.some((signature) => signature.test(response.body))) return []

      const url = new URL(directory, ctx.finalUrl).href
      const entries = [...response.body.matchAll(/<a[^>]+href="([^"?][^"]*)"/gi)]
        .map((match) => match[1])
        .filter((href): href is string => Boolean(href) && href !== '../')
        .slice(0, 12)

      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'medium',
          title: 'A directory returns its file listing',
          description:
            `${url} responds with an index of its contents rather than a page. Anything left in that ` +
            'directory — a stale backup, an editor swap file, a build artefact — is discoverable by ' +
            'name without guessing. Directory listing is almost always a web server default nobody ' +
            'switched off rather than a decision.',
          evidence: { directory: url, sampleEntries: entries },
          remediation: 'Disable autoindex for this directory (nginx `autoindex off;`, Apache `Options -Indexes`).',
          fixPrompt:
            `The directory ${url} on this site returns a file listing. Turn directory indexing off ` +
            'at the web server — nginx: `autoindex off;`, Apache: `Options -Indexes`, or the ' +
            'equivalent on the CDN. Then look at what the listing exposed and remove anything that ' +
            'should not be deployed at all; the listing is the symptom, the files are the problem.',
        } satisfies Finding,
      ]
    }

    return []
  },
}
