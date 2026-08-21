/**
 * Shared <meta> lookups for the SEO checks.
 *
 * Why not plain CSS selectors: HTML attribute VALUES are case-sensitive to a
 * selector engine but not to a crawler — `<meta name="Description">` and
 * `<meta property="OG:IMAGE">` are both honoured in the wild. Matching by
 * lowercased attribute keeps us from reporting "missing" on a tag that Google
 * reads fine, which is the worst kind of false positive: confidently wrong.
 *
 * Everything is returned as trimmed strings in document order, so a check can
 * ask "how many?" (duplicates) and "what does the first one say?" without ever
 * touching a DOM node itself.
 */

import type { CheckContext } from '../types.ts'

/** `content` of every <meta name="…"> matching `name`, case-insensitively. */
export function metaContents(ctx: CheckContext, name: string): string[] {
  return contentsWhere(ctx, 'name', name)
}

/**
 * `content` of every Open Graph tag for `property`. OG is defined on the
 * `property` attribute, but `name` is a widespread (and parser-tolerated)
 * variant — accept both, dedupe nothing, report what is there.
 */
export function ogContents(ctx: CheckContext, property: string): string[] {
  return [...contentsWhere(ctx, 'property', property), ...contentsWhere(ctx, 'name', property)]
}

function contentsWhere(ctx: CheckContext, attribute: 'name' | 'property', value: string): string[] {
  const wanted = value.toLowerCase()
  return ctx
    .$('meta')
    .toArray()
    .filter((el) => (ctx.$(el).attr(attribute) ?? '').trim().toLowerCase() === wanted)
    .map((el) => (ctx.$(el).attr('content') ?? '').trim())
}

/** Character count as a human (and Google's SERP) sees it — astral chars count once. */
export function charCount(text: string): number {
  return [...text].length
}
