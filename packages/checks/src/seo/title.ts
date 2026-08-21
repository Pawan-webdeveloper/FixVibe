/**
 * <title> — the clickable headline in every search result and the strongest
 * single on-page signal. A missing or empty title is a real ranking problem;
 * length is only presentation, so those findings stay low/info and never
 * dominate the SEO score.
 *
 * Inline SVG also defines a <title> element (it is the accessible name of the
 * graphic). Counting those as page titles would report "multiple titles" on
 * every site that ships an icon set — so they are excluded.
 */

import type { Check, Finding } from '../types.ts'
import { charCount } from './meta-tags.ts'

const ID = 'seo.title'

/** Google truncates a desktop SERP title around 60 chars; under ~30 wastes the slot. */
const MAX_CHARS = 60
const MIN_CHARS = 30

export const titleCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'Page title',

  run(ctx) {
    const findings: Finding[] = []
    const titles = ctx
      .$('title')
      .toArray()
      .filter((el) => ctx.$(el).parents('svg').length === 0)

    if (titles.length === 0) {
      return [
        {
          checkId: ID,
          category: 'seo',
          severity: 'high',
          title: 'Missing <title>',
          description:
            'The page has no <title> element. Google falls back to guessing a headline from the page ' +
            'body or from anchor text pointing at the page — usually a worse one than you would write.',
          remediation: 'Add one <title> in <head> describing this specific page.',
          fixPrompt:
            'This page has no <title> element. Add exactly one inside <head>, describing this specific ' +
            'page (primary topic first, brand last), 30–60 characters. If the app renders titles via a ' +
            'framework head API, set it there so it is present in the server-rendered HTML.',
        } satisfies Finding,
      ]
    }

    if (titles.length > 1) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: `Multiple <title> elements (${titles.length})`,
        description:
          'Crawlers use only the first <title>. More than one usually means a layout template and a ' +
          'page template are both injecting a title, so the one that wins is whichever renders first.',
        evidence: { titles: titles.map((el) => ctx.$(el).text().trim()).slice(0, 5) },
        remediation: 'Keep exactly one <title>; remove the duplicate injection in the layout or page template.',
        fixPrompt:
          `This page renders ${titles.length} <title> elements. Find the templates that inject them and ` +
          'keep exactly one, so the title that reaches crawlers is the intended one.',
      })
    }

    const text = ctx.$(titles[0]!).text().trim()

    if (!text) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'high',
        title: 'Empty <title>',
        description:
          'A <title> element is present but contains no text — to a crawler this is the same as having ' +
          'no title, except it also hides the problem from most template linters.',
        remediation: 'Give the <title> real text, or remove the empty tag and render the title properly.',
        fixPrompt:
          'This page has an empty <title> element. Fill it with the page title. If the value comes from ' +
          'data fetched on the client, move it to server-side rendering so crawlers see it in the HTML.',
      })
      return findings // length rules on an empty string would just be noise
    }

    const length = charCount(text)

    if (length > MAX_CHARS) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: `Title is ${length} characters (over ${MAX_CHARS})`,
        description:
          `Search results cut titles off around ${MAX_CHARS} characters, so everything past that point ` +
          'is invisible to the person deciding whether to click.',
        evidence: { title: text, length },
        remediation: `Shorten the title to ${MAX_CHARS} characters or fewer, keeping the key words first.`,
        fixPrompt:
          `Shorten this page's <title> to ${MAX_CHARS} characters or fewer. Current value (${length} ` +
          `characters): "${text}". Keep the primary topic at the front and shorten or drop the trailing brand suffix.`,
      })
    } else if (length < MIN_CHARS) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'info',
        title: `Title is only ${length} characters`,
        description:
          `Titles under ~${MIN_CHARS} characters leave most of the search-result headline unused and ` +
          'often get rewritten by Google using page content instead.',
        evidence: { title: text, length },
        remediation: 'Expand the title with the page topic and brand name, staying under 60 characters.',
        fixPrompt:
          `Expand this page's <title> — currently "${text}" (${length} characters) — to roughly ` +
          `${MIN_CHARS}–${MAX_CHARS} characters by adding the page's topic and the brand name.`,
      })
    }

    return findings
  },
}
