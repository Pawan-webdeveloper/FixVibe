/**
 * <meta name="description"> — the snippet under the title in a search result.
 * It is not a ranking factor, so nothing here is above `low`: a missing
 * description costs click-through, not position, and saying otherwise would
 * make the whole report less trustworthy.
 */

import type { Check, Finding } from '../types.ts'
import { charCount, metaContents } from './meta-tags.ts'

const ID = 'seo.meta-description'

/** Google truncates snippets around 160 chars; under ~50 it usually writes its own. */
const MAX_CHARS = 160
const MIN_CHARS = 50

export const metaDescriptionCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'Meta description',

  run(ctx) {
    const findings: Finding[] = []
    const contents = metaContents(ctx, 'description')

    if (contents.length === 0) {
      return [
        {
          checkId: ID,
          category: 'seo',
          severity: 'low',
          title: 'Missing meta description',
          description:
            'No <meta name="description"> was found. Google will assemble a snippet from page text ' +
            'instead, which reads like an excerpt rather than a pitch and costs click-through.',
          remediation: 'Add a 50–160 character <meta name="description"> summarising this page.',
          fixPrompt:
            'Add a <meta name="description" content="…"> tag inside <head> for this page. Write 50–160 ' +
            'characters describing what the page offers and why to click, not a keyword list.',
        } satisfies Finding,
      ]
    }

    if (contents.length > 1) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: `Multiple meta descriptions (${contents.length})`,
        description:
          'More than one description tag is present. Crawlers pick one and ignore the rest, so which ' +
          'text represents the page in search results is decided by template ordering, not by you.',
        evidence: { descriptions: contents.slice(0, 5) },
        remediation: 'Keep exactly one <meta name="description">; remove the duplicate injection.',
        fixPrompt:
          `This page renders ${contents.length} <meta name="description"> tags. Find the layout and page ` +
          'templates injecting them and keep exactly one.',
      })
    }

    const content = contents[0]!

    if (!content) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: 'Empty meta description',
        description:
          'The description tag exists but its content attribute is empty, which a crawler treats ' +
          'exactly like a missing description.',
        remediation: 'Fill in the content attribute, or remove the tag and render it with real text.',
        fixPrompt:
          'This page has a <meta name="description"> with an empty content attribute. Fill it with a ' +
          '50–160 character summary of the page, generated server-side so crawlers can read it.',
      })
      return findings
    }

    const length = charCount(content)

    if (length > MAX_CHARS) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'info',
        title: `Meta description is ${length} characters (over ${MAX_CHARS})`,
        description:
          `Snippets are cut off around ${MAX_CHARS} characters, so the closing part of this description ` +
          'never reaches the reader.',
        evidence: { description: content, length },
        remediation: `Trim the description to ${MAX_CHARS} characters or fewer, front-loading the value.`,
        fixPrompt:
          `Shorten this page's meta description to ${MAX_CHARS} characters or fewer. Current value ` +
          `(${length} characters): "${content}".`,
      })
    } else if (length < MIN_CHARS) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'info',
        title: `Meta description is only ${length} characters`,
        description:
          'Very short descriptions are routinely discarded by Google in favour of scraped page text, ' +
          'which wastes the tag entirely.',
        evidence: { description: content, length },
        remediation: `Expand the description to roughly ${MIN_CHARS}–${MAX_CHARS} characters.`,
        fixPrompt:
          `Expand this page's meta description — currently "${content}" (${length} characters) — to ` +
          `${MIN_CHARS}–${MAX_CHARS} characters covering what the page offers and who it is for.`,
      })
    }

    return findings
  },
}
