/**
 * <h1> — the on-page restatement of what the title promises. HTML5 technically
 * permits several (one per sectioning element), and Google has said repeatedly
 * that multiple H1s are fine, so "more than one" is an outline-quality nudge,
 * not a defect. A page with NO heading at all is the finding that matters.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'seo.h1'

export const h1Check: Check = {
  id: ID,
  category: 'seo',
  title: 'H1 heading',

  run(ctx) {
    const headings = ctx
      .$('h1')
      .toArray()
      .map((el) => ctx.$(el).text().replace(/\s+/g, ' ').trim())

    if (headings.length === 0) {
      return [
        {
          checkId: ID,
          category: 'seo',
          severity: 'medium',
          title: 'No <h1> heading',
          description:
            'The page has no H1. Both crawlers and screen readers use it as the page-level heading, ' +
            'and its absence usually means the visible headline is a styled <div> carrying no semantics.',
          remediation: 'Make the main visible headline an <h1>.',
          fixPrompt:
            'This page renders no <h1>. Find the main visible headline and mark it up as <h1> (keep the ' +
            'existing styling by moving the classes onto the h1 rather than adding a wrapper).',
        } satisfies Finding,
      ]
    }

    const empty = headings.every((text) => text === '')
    if (empty) {
      return [
        {
          checkId: ID,
          category: 'seo',
          severity: 'medium',
          title: 'H1 contains no text',
          description:
            'An <h1> exists but is empty — typically a logo image or icon with no alt text inside it. ' +
            'Crawlers and screen readers both read nothing.',
          evidence: { count: headings.length },
          remediation: 'Put the headline text inside the <h1>, or give the image inside it descriptive alt text.',
          fixPrompt:
            'This page has an <h1> with no text content. If it wraps a logo or icon, add descriptive alt ' +
            'text to that image; otherwise put the page headline inside the h1.',
        } satisfies Finding,
      ]
    }

    if (headings.length > 1) {
      return [
        {
          checkId: ID,
          category: 'seo',
          severity: 'info',
          title: `Page has ${headings.length} <h1> headings`,
          description:
            'Multiple H1s are valid HTML5 and Google handles them, but they often signal that a hero ' +
            'section and a content title are competing rather than nesting.',
          evidence: { headings: headings.slice(0, 5) },
          remediation: 'Keep one H1 as the page topic and demote the supporting headings to <h2>.',
          fixPrompt:
            `This page has ${headings.length} <h1> elements: ${JSON.stringify(headings.slice(0, 5))}. ` +
            'Keep the one that states the page topic and change the others to <h2>, preserving their styling.',
        } satisfies Finding,
      ]
    }

    return []
  },
}
