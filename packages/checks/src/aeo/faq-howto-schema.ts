/**
 * A page that already answers questions, without saying so in schema.
 *
 * The calibration that makes this check worth having: it does NOT tell every
 * page to add FAQPage markup. Most pages have no FAQ, and inventing one to
 * satisfy a scanner is how sites end up with fake Q&A that helps nobody — and
 * that Google penalises.
 *
 * It fires only when the page's own markup shows question-and-answer content
 * that is not declared: headings phrased as questions, or a stack of
 * <details> accordions. Then the schema is describing something that is
 * genuinely there, which is the only case where adding it is honest.
 */

import type { Check, Finding } from '../types.ts'
import { hasType, jsonLdNodes } from './content.ts'

const ID = 'aeo.faq-howto-schema'

/** One question heading is a rhetorical device; several is a FAQ. */
const MIN_QUESTIONS = 3

export const faqHowToSchemaCheck: Check = {
  id: ID,
  category: 'aeo',
  title: 'FAQ and HowTo schema',

  run(ctx) {
    const questionHeadings = ctx
      .$('h2, h3, h4, summary')
      .toArray()
      .map((el) => ctx.$(el).text().replace(/\s+/g, ' ').trim())
      .filter((text) => text.endsWith('?'))

    const accordions = ctx.$('details').length

    const looksLikeFaq = questionHeadings.length >= MIN_QUESTIONS || accordions >= MIN_QUESTIONS
    if (!looksLikeFaq) return []

    if (hasType(jsonLdNodes(ctx), 'faqpage', 'howto', 'qapage')) return []

    return [
      {
        checkId: ID,
        category: 'aeo',
        severity: 'info',
        title: 'Question-and-answer content with no FAQPage schema',
        description:
          `This page has ${questionHeadings.length} headings phrased as questions` +
          (accordions > 0 ? ` and ${accordions} expandable sections` : '') +
          ', but no FAQPage or HowTo markup declaring them. Declared Q&A pairs can be lifted whole ' +
          'into an answer with attribution; undeclared ones have to be inferred from layout, which ' +
          'assistants do inconsistently.',
        evidence: { questionHeadings: questionHeadings.slice(0, 6), accordions },
        remediation: 'Add a FAQPage JSON-LD block whose questions and answers match the visible ones.',
        fixPrompt:
          'This page already contains a FAQ but does not declare it. Add a schema.org FAQPage block ' +
          'inside <script type="application/ld+json"> with a mainEntity array of Question objects, ' +
          'each with an acceptedAnswer. The questions and answers MUST match the visible text exactly ' +
          '— markup describing content that is not on the page is a guidelines violation, not an ' +
          'optimisation. Generate it from the same source as the rendered FAQ so the two cannot drift.',
      } satisfies Finding,
    ]
  },
}
