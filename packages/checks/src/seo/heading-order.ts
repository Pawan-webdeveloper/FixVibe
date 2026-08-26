/**
 * Heading levels that skip a rank.
 *
 * Headings are a document outline, not a set of font sizes. An h1 followed by
 * an h3 tells a screen reader — and anything else consuming the structure —
 * that a section was omitted, so a user navigating by heading lands somewhere
 * that appears to be missing its parent.
 *
 * Reported once with the whole sequence rather than once per skip: the cause is
 * a heading chosen for its size, the fix is the same edit throughout, and a
 * page with six skips would otherwise produce six findings about one habit.
 *
 * Headings inside inline SVG are excluded — an <h1> is not valid there, but
 * <title> and role-based markup inside icons confuse a naive walk.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'seo.heading-order'

export const headingOrderCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'Heading order',

  run(ctx) {
    const headings = ctx
      .$('h1, h2, h3, h4, h5, h6')
      .toArray()
      .filter((el) => ctx.$(el).parents('svg').length === 0)
      .map((el) => ({
        level: Number((el as { tagName?: string }).tagName?.slice(1) ?? 0),
        text: ctx.$(el).text().replace(/\s+/g, ' ').trim().slice(0, 60),
      }))
      .filter((h) => h.level >= 1 && h.level <= 6)

    if (headings.length < 2) return []

    const skips: string[] = []
    let previous = headings[0]!.level

    for (const heading of headings.slice(1)) {
      // Going back up any number of levels is normal — a new section. Only
      // going DOWN by more than one skips a rank.
      if (heading.level > previous + 1) {
        skips.push(`h${previous} → h${heading.level} ("${heading.text}")`)
      }
      previous = heading.level
    }

    if (skips.length === 0) return []

    return [
      {
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: `Heading levels skip a rank ${skips.length} time${skips.length === 1 ? '' : 's'}`,
        description:
          `The outline jumps a level: ${skips.slice(0, 4).join(', ')}. Anyone navigating this page by ` +
          'heading — which is how screen reader users move through a long document — arrives at a ' +
          'section whose parent appears to be missing. It is almost always a heading picked for its ' +
          'size rather than its place in the outline.',
        evidence: { skips, outline: headings.map((h) => `h${h.level}`).join(' ') },
        remediation: 'Use the level that matches the nesting, and set size with CSS.',
        fixPrompt:
          `This page skips heading levels: ${skips.slice(0, 4).join(', ')}. Renumber the headings so ` +
          'each is exactly one level below its section parent, and control size with a class instead ' +
          'of the tag. Do not change the text — this is a structural edit.',
      } satisfies Finding,
    ]
  },
}
