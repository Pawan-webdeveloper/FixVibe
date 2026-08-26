/**
 * Links whose text says nothing on its own.
 *
 * Screen reader users routinely pull up a list of every link on a page and
 * navigate from it. In that list there is no surrounding sentence — so twelve
 * entries reading "Read more" are twelve identical, useless choices, and a link
 * with no text at all is an entry that cannot be read out.
 *
 * Two states, both concrete: text that is a known non-phrase, and no accessible
 * name at all. Nothing here judges whether wording is good, which is writing
 * advice and not something a scanner should be issuing.
 */

import type { Check, Finding } from '../../types.ts'

const ID = 'accessibility.link-text'

/**
 * Phrases that carry no meaning once the surrounding sentence is gone.
 *
 * Two words were removed after this fired on real sites, and both removals are
 * the same lesson: a word that is filler in one place is a label in another.
 *
 *   "link"     — Stripe ships a product called Link, so the check reported a
 *                brand name as placeholder text. Nobody writes a link whose
 *                text is literally "link" as filler anyway; "this link" still
 *                catches the real case.
 *   "continue" — the correct, standard label for the next step of a checkout
 *                or a multi-step form. Flagging it would argue with good UX.
 */
const EMPTY_PHRASES = new Set([
  'click here',
  'here',
  'read more',
  'more',
  'learn more',
  'this',
  'this link',
  'details',
  'go',
])

export const linkTextCheck: Check = {
  id: ID,
  category: 'accessibility',
  title: 'Link text',

  run(ctx) {
    // axe-core audited the RENDERED accessibility tree, which sees implicit
    // roles, cross-document label associations and elements built at runtime
    // that this parser cannot. When it has spoken, this check stands down:
    // two sources reporting one defect would charge the site twice, and the
    // less accurate of the two would be setting the severity.
    if (ctx.rendered?.axe) return []

    const vague: string[] = []
    const nameless: string[] = []

    for (const el of ctx.$('a[href]').toArray()) {
      const link = ctx.$(el)

      // An explicit accessible name overrides whatever the text says.
      const ariaLabel = (link.attr('aria-label') ?? '').trim()
      if (ariaLabel) continue
      if ((link.attr('aria-labelledby') ?? '').trim()) continue
      if ((link.attr('title') ?? '').trim()) continue

      const text = link.text().replace(/\s+/g, ' ').trim()

      if (!text) {
        // An icon link is only nameless if the image inside it is too.
        const imageAlt = link
          .find('img')
          .toArray()
          .map((img) => (ctx.$(img).attr('alt') ?? '').trim())
          .find(Boolean)
        if (imageAlt) continue
        nameless.push(link.attr('href') ?? '<no href>')
        continue
      }

      // Trailing decoration is stripped before matching: "Read more →" and
      // "Read more..." are the same phrase wearing different chrome. Any
      // trailing non-letter works, in any script, rather than a list of the
      // arrow characters somebody happened to think of.
      if (EMPTY_PHRASES.has(text.toLowerCase().replace(/[^\p{L}\p{N}]+$/u, ''))) vague.push(text)
    }

    const findings: Finding[] = []

    if (nameless.length > 0) {
      findings.push({
        checkId: ID,
        category: 'accessibility',
        severity: 'medium',
        title: `${nameless.length} link${nameless.length === 1 ? '' : 's'} with no accessible name`,
        description:
          'These links contain no text, no labelled image and no aria-label, so there is nothing for ' +
          `a screen reader to announce: ${nameless.slice(0, 4).join(', ')}. They are usually icon ` +
          'links — a social glyph, a close button — where the icon is a background image or an ' +
          'unlabelled SVG.',
        evidence: { hrefs: nameless.slice(0, 8), total: nameless.length },
        remediation: 'Add aria-label to each icon link, or alt text to the image inside it.',
        fixPrompt:
          `These links on this page have no accessible name: ${nameless.slice(0, 6).join(', ')}. Add ` +
          'aria-label describing the DESTINATION ("Darvin on GitHub", not "GitHub icon"). If the link ' +
          'wraps an <img>, giving that image alt text works just as well. For an inline <svg>, add ' +
          'aria-hidden="true" to the svg and put the label on the link.',
      })
    }

    if (vague.length > 0) {
      const unique = [...new Set(vague)]
      findings.push({
        checkId: ID,
        category: 'accessibility',
        severity: 'low',
        title: `${vague.length} links read as ${unique.map((t) => `"${t}"`).join(', ')}`,
        description:
          'Out of context these say nothing about where they go. Screen reader users often navigate ' +
          'from a generated list of a page\'s links, where the surrounding sentence is not present — ' +
          'so several identical "Read more" entries are several identical, unusable choices.',
        evidence: { phrases: unique, total: vague.length },
        remediation: 'Make the link text name its destination, or add an aria-label that does.',
        fixPrompt:
          `This page has ${vague.length} links whose text is ${unique.map((t) => `"${t}"`).join(', ')}. ` +
          'Rewrite each to name its destination — "Read the pricing guide" rather than "Read more". ' +
          'Where the visible wording has to stay for the design, keep it and add ' +
          'aria-label="Read the pricing guide" so the link list is usable.',
      })
    }

    return findings
  },
}
