/**
 * Who wrote this, and when — on pages that are writing.
 *
 * An assistant deciding whether to cite a claim weighs whether the source is
 * attributable and current. An undated article is indistinguishable from one
 * written five years ago, and an unattributed one has nobody standing behind
 * it, so both lose to a competitor's page that carries the same claim with a
 * name and a date on it.
 *
 * Only runs on pages that are actually articles. Telling a pricing page it has
 * no author is the kind of finding that teaches people to skip the section.
 */

import type { Check, CheckContext, Finding } from '../types.ts'
import { isArticlePage, jsonLdNodes } from './content.ts'

const ID = 'aeo.author-date'

function metaContent(ctx: CheckContext, ...names: string[]): string | null {
  const wanted = new Set(names.map((n) => n.toLowerCase()))
  for (const el of ctx.$('meta').toArray()) {
    const key = (ctx.$(el).attr('name') ?? ctx.$(el).attr('property') ?? '').trim().toLowerCase()
    if (!wanted.has(key)) continue
    const content = (ctx.$(el).attr('content') ?? '').trim()
    if (content) return content
  }
  return null
}

export const authorDateCheck: Check = {
  id: ID,
  category: 'aeo',
  title: 'Author and date',

  run(ctx) {
    const nodes = jsonLdNodes(ctx)
    if (!isArticlePage(ctx, nodes)) return []

    const findings: Finding[] = []

    const hasAuthor =
      nodes.some((node) => Boolean(node['author'])) ||
      metaContent(ctx, 'author', 'article:author') !== null ||
      ctx.$('[rel~="author"], [itemprop="author"]').length > 0

    if (!hasAuthor) {
      findings.push({
        checkId: ID,
        category: 'aeo',
        severity: 'info',
        title: 'Article has no attributable author',
        description:
          'Nothing on this page names who wrote it, in markup or in metadata. Attribution is one of ' +
          'the signals used to decide whether a claim is worth repeating — an anonymous page loses ' +
          'to a byline making the same point.',
        remediation: 'Add an author to the article JSON-LD, or a <meta name="author"> tag.',
        fixPrompt:
          'This article page declares no author. Add "author": { "@type": "Person", "name": "...", ' +
          '"url": "..." } to its Article JSON-LD, and show the byline in the visible markup too — the ' +
          'structured data should describe what a reader can see.',
      })
    }

    const hasDate =
      nodes.some((node) => Boolean(node['datePublished'] ?? node['dateModified'])) ||
      metaContent(ctx, 'article:published_time', 'article:modified_time', 'date') !== null ||
      ctx.$('time[datetime]').length > 0

    if (!hasDate) {
      findings.push({
        checkId: ID,
        category: 'aeo',
        severity: 'info',
        title: 'Article carries no publication date',
        description:
          'No datePublished, no article:published_time, and no <time datetime>. An undated page is ' +
          'treated as one of unknown age, which is the same as old — on any topic where currency ' +
          'matters, a dated competitor is cited instead.',
        remediation: 'Add datePublished (and dateModified when it is edited) to the article JSON-LD.',
        fixPrompt:
          'This article page has no machine-readable date. Add "datePublished" — and "dateModified" ' +
          'whenever the post is edited — to its Article JSON-LD in ISO 8601 form, and render the date ' +
          'in a <time datetime="..."> element so a reader sees the same thing a crawler does.',
      })
    }

    return findings
  },
}
