/**
 * hreflang annotations, when a site has them.
 *
 * Silent on monolingual sites, which is most of them. Telling a single-language
 * site it lacks hreflang would be noise on the overwhelming majority of scans,
 * and adding the tags without translations to point at is worse than not having
 * them.
 *
 * When the tags ARE present the site has already decided to run alternates, and
 * the errors below are the ones that quietly stop the cluster working: search
 * engines discard a set that does not reciprocate, and a set with no
 * self-reference is not a set at all.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'seo.hreflang'

/** Same shape the lang check uses: loose BCP 47, plus the x-default token. */
const HREFLANG = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?)$/i

export const hreflangCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'hreflang',

  run(ctx) {
    const entries = ctx
      .$('link[rel="alternate"][hreflang]')
      .toArray()
      .map((el) => ({
        hreflang: (ctx.$(el).attr('hreflang') ?? '').trim(),
        href: (ctx.$(el).attr('href') ?? '').trim(),
      }))
      .filter((entry) => entry.hreflang)

    if (entries.length === 0) return []

    const findings: Finding[] = []

    const malformed = entries.filter((entry) => !HREFLANG.test(entry.hreflang))
    if (malformed.length > 0) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: `${malformed.length} hreflang value${malformed.length === 1 ? '' : 's'} are not valid language tags`,
        description:
          `These are ignored entirely: ${malformed.map((m) => `"${m.hreflang}"`).join(', ')}. The usual ` +
          'causes are an underscore instead of a hyphen, or a country code used on its own — hreflang ' +
          'takes a language, optionally followed by a region, never a region alone.',
        evidence: { malformed },
        remediation: 'Use language[-REGION], e.g. en, en-GB, pt-BR — or x-default.',
        fixPrompt:
          `These hreflang values on this page are not valid BCP 47 tags: ` +
          `${malformed.map((m) => m.hreflang).join(', ')}. Correct them to language[-REGION] form ` +
          '("en-GB", not "en_GB" and not "GB"), and keep x-default for the unmatched-locale fallback.',
      })
    }

    const relative = entries.filter((entry) => entry.href && !/^https?:\/\//i.test(entry.href))
    if (relative.length > 0) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: 'hreflang links are not absolute URLs',
        description:
          'hreflang alternates must be fully-qualified URLs. A relative href is resolved differently ' +
          'by different consumers, and a cluster that does not agree on the addresses of its members ' +
          'is discarded rather than half-applied.',
        evidence: { relative: relative.slice(0, 5) },
        remediation: 'Emit each alternate as an absolute https:// URL including the host.',
        fixPrompt:
          'The hreflang alternates on this page use relative URLs. Emit each href as an absolute URL ' +
          'with scheme and host — build them from the canonical origin wherever the tags are generated.',
      })
    }

    // A cluster must include the page it is on, or the set is incomplete and
    // every member gets dropped.
    const here = ctx.finalUrl.href.replace(/\/$/, '')
    const selfReferenced = entries.some((entry) => entry.href.replace(/\/$/, '') === here)
    if (!selfReferenced && relative.length === 0) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: 'hreflang set does not include this page',
        description:
          `None of the ${entries.length} alternates points back at ${ctx.finalUrl.href}. Every page in ` +
          'a cluster has to list itself alongside its siblings; without that the set is incomplete and ' +
          'search engines ignore the whole group rather than applying part of it.',
        evidence: { page: ctx.finalUrl.href, alternates: entries.map((e) => e.href).slice(0, 6) },
        remediation: 'Add a self-referencing alternate with this page\'s own language.',
        fixPrompt:
          `The hreflang set on ${ctx.finalUrl.href} lists alternates but not the page itself. Add a ` +
          '<link rel="alternate" hreflang="<this page\'s language>" href="<this page\'s canonical URL>"> ' +
          'and make sure every page in the cluster emits the identical full set, itself included.',
      })
    }

    return findings
  },
}
