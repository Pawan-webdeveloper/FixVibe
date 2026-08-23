/**
 * Can an extractor find a section of this page to quote?
 *
 * Models answering a question pull a passage, not a document. A long page with
 * no subheadings has no passage boundaries — the whole thing is one block, and
 * the retriever either takes the wrong part or takes nothing.
 *
 * Deliberately narrow. "Well structured" is a judgement, and a scanner that
 * hands out writing advice is one people stop believing; what is measurable is
 * a lot of text with nothing to divide it. Short pages are left alone entirely,
 * because a landing page with one heading is doing the right thing.
 */

import type { Check, Finding } from '../types.ts'
import { visibleText, wordCount } from './content.ts'

const ID = 'aeo.answer-structure'

/** Below this, one heading is a complete structure and nothing needs saying. */
const LONG_PAGE_WORDS = 400

/** A paragraph past this is a wall — the retriever takes all of it or none. */
const WALL_OF_TEXT_CHARS = 1500

export const answerStructureCheck: Check = {
  id: ID,
  category: 'aeo',
  title: 'Answer structure',

  run(ctx) {
    const words = wordCount(visibleText(ctx))
    if (words < LONG_PAGE_WORDS) return []

    const findings: Finding[] = []
    const subheadings = ctx.$('h2, h3').length

    if (subheadings === 0) {
      findings.push({
        checkId: ID,
        category: 'aeo',
        severity: 'low',
        title: 'Long page with no subheadings',
        description:
          `This page carries roughly ${words} words under no h2 or h3 at all. Retrieval works by ` +
          'pulling the section that answers a question, and section boundaries come from headings — ' +
          'without them the page is one undivided block, so an assistant either quotes the wrong part ' +
          'of it or skips it for a competitor whose page it can navigate.',
        evidence: { words, subheadings: 0 },
        remediation: 'Break the page into sections with h2 (and h3) headings that name what each answers.',
        fixPrompt:
          `This page has about ${words} words and no h2/h3 headings. Split the content into sections ` +
          'and give each a heading phrased as the thing a reader would search for — "How pricing ' +
          'works", not "Details". Keep the existing prose; this is a structural edit, not a rewrite.',
      })
    }

    const longest = Math.max(
      0,
      ...ctx
        .$('p')
        .toArray()
        .map((el) => ctx.$(el).text().replace(/\s+/g, ' ').trim().length),
    )

    if (longest > WALL_OF_TEXT_CHARS) {
      findings.push({
        checkId: ID,
        category: 'aeo',
        severity: 'info',
        title: `A single paragraph runs ${longest} characters`,
        description:
          'One paragraph carries a large share of the page. Retrievers chunk on paragraph boundaries, ' +
          'so an oversized block is either truncated mid-argument or pulled in whole with the ' +
          'relevant sentence buried in it.',
        evidence: { longestParagraphChars: longest, words },
        remediation: 'Split the longest paragraphs so each makes one point.',
        fixPrompt:
          `The longest paragraph on this page is ${longest} characters. Split the oversized ` +
          'paragraphs so each covers a single point, and pull any enumerations out into a list. Do ' +
          'not change the wording, only the breaks.',
      })
    }

    return findings
  },
}
