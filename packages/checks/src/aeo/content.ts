/**
 * Shared reading of the page for the AEO checks.
 *
 * All of these answer questions about what a language model would actually see
 * if it fetched this URL — which is not what a browser sees, because the
 * crawlers behind today's assistants overwhelmingly do not run JavaScript.
 */

import type { CheckContext } from '../types.ts'

/**
 * The text a reader (or a crawler) actually gets.
 *
 * cheerio's `.text()` includes the CONTENTS of <script> and <style>, so calling
 * it directly on the body counts a JSON blob or a minified bundle as prose and
 * makes an empty single-page app look content-rich. Everything non-rendering is
 * removed from a clone first.
 */
export function visibleText(ctx: CheckContext): string {
  const body = ctx.$('body').clone()
  body.find('script, style, noscript, template, svg').remove()
  return body.text().replace(/\s+/g, ' ').trim()
}

export function wordCount(text: string): number {
  return text ? text.split(' ').filter(Boolean).length : 0
}

/**
 * Every schema.org object on the page, flattened.
 *
 * A block may be one node, an array of nodes, or a @graph container, and real
 * sites use all three. Checks that care about "is there an Organization
 * anywhere" should not each re-learn that.
 */
export function jsonLdNodes(ctx: CheckContext): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = []

  const blocks = ctx
    .$('script')
    .toArray()
    .filter((el) => (ctx.$(el).attr('type') ?? '').toLowerCase().includes('ld+json'))

  for (const el of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(ctx.$(el).text().trim())
    } catch {
      continue // seo.structured-data owns reporting broken JSON-LD
    }
    collect(parsed, nodes)
  }

  return nodes
}

function collect(value: unknown, into: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into)
    return
  }
  if (typeof value !== 'object' || value === null) return

  const node = value as Record<string, unknown>
  into.push(node)
  if ('@graph' in node) collect(node['@graph'], into)
}

/** @type may be a string or an array; both are valid and both appear in the wild. */
export function typesOf(node: Record<string, unknown>): string[] {
  const type = node['@type']
  if (typeof type === 'string') return [type.toLowerCase()]
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase())
  return []
}

export function hasType(nodes: Record<string, unknown>[], ...wanted: string[]): boolean {
  const want = new Set(wanted.map((w) => w.toLowerCase()))
  return nodes.some((node) => typesOf(node).some((t) => want.has(t)))
}

const ARTICLE_TYPES = [
  'article',
  'blogposting',
  'newsarticle',
  'techarticle',
  'scholarlyarticle',
  'report',
]

/**
 * Is this a piece of writing rather than a landing or listing page?
 *
 * Several checks below only make sense on an article — telling a pricing page
 * it has no author or cites no sources is noise. Three independent signals,
 * any one of which is enough: the schema says so, the markup says so, or Open
 * Graph says so.
 */
export function isArticlePage(ctx: CheckContext, nodes = jsonLdNodes(ctx)): boolean {
  if (hasType(nodes, ...ARTICLE_TYPES)) return true
  if (ctx.$('article').length > 0) return true

  // og:type is declared on `property` per the OG spec but `name` is a common
  // and parser-tolerated variant, so both are accepted.
  const ogType = ctx
    .$('meta')
    .toArray()
    .find((el) => {
      const key = ctx.$(el).attr('property') ?? ctx.$(el).attr('name') ?? ''
      return key.toLowerCase() === 'og:type'
    })
  if (!ogType) return false

  return (ctx.$(ogType).attr('content') ?? '').trim().toLowerCase() === 'article'
}
