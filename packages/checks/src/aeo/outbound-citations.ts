/**
 * Does a long article point at anything outside itself?
 *
 * Retrieval systems treat a page that grounds its claims in identifiable
 * sources differently from one that asserts them alone. This is the weakest
 * signal in the pillar and it is scoped accordingly: substantial articles only,
 * zero external links only, and `info` only.
 *
 * What it explicitly does not do is ask for MORE links on a page that already
 * has some. "Add citations" past that point is writing advice, and this is a
 * scanner.
 */

import type { Check, Finding } from '../types.ts'
import { isArticlePage, visibleText, wordCount } from './content.ts'

const ID = 'aeo.outbound-citations'

/** Short posts legitimately stand alone; this is about long-form claims. */
const SUBSTANTIAL_WORDS = 600

export const outboundCitationsCheck: Check = {
  id: ID,
  category: 'aeo',
  title: 'Outbound citations',

  run(ctx) {
    if (!isArticlePage(ctx)) return []

    const words = wordCount(visibleText(ctx))
    if (words < SUBSTANTIAL_WORDS) return []

    const external = ctx
      .$('a[href]')
      .toArray()
      .map((el) => ctx.$(el).attr('href') ?? '')
      .filter((href) => {
        try {
          const url = new URL(href, ctx.finalUrl)
          return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ctx.finalUrl.hostname
        } catch {
          return false
        }
      })

    if (external.length > 0) return []

    return [
      {
        checkId: ID,
        category: 'aeo',
        severity: 'info',
        title: 'Long article with no outbound links',
        description:
          `About ${words} words of article content link to nothing outside this domain. Assistants ` +
          'weigh whether a claim can be traced, and a page that cites its sources is easier to repeat ' +
          'with confidence than one asserting the same thing alone.',
        evidence: { words, externalLinks: 0 },
        remediation: 'Link the claims that rest on someone else\'s data, spec or documentation to the source.',
        fixPrompt:
          'This long article links to nothing outside its own domain. Find the claims that rest on ' +
          'external facts — a specification, a study, a vendor\'s documentation — and link them to the ' +
          'primary source. Do not add links for their own sake; an irrelevant citation is worse than ' +
          'none.',
      } satisfies Finding,
    ]
  },
}
