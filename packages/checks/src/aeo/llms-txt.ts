/**
 * /llms.txt — a plain-text file telling AI crawlers what a site is and where
 * its best material lives, in the way robots.txt tells search crawlers what to
 * fetch.
 *
 * It is an emerging convention, not a standard: a small minority of sites ship
 * one. So its absence is reported at `info` and worded as an opportunity, never
 * as something broken. A scanner that calls every site defective for missing a
 * one-year-old convention is a scanner people stop reading.
 *
 * The interesting finding is the opposite one: a file that exists but is the
 * app shell, which means a catch-all route is answering and the effort spent
 * writing it is doing nothing.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'aeo.llms-txt'

const PATH = '/llms.txt'

export const llmsTxtCheck: Check = {
  id: ID,
  category: 'aeo',
  title: 'llms.txt',

  async run(ctx) {
    const response = await ctx.probe(PATH)

    // null is "we could not ask", never "it is not there".
    if (!response) return []

    const url = new URL(PATH, ctx.finalUrl).href

    if (response.status !== 200) {
      return [
        {
          checkId: ID,
          category: 'aeo',
          severity: 'info',
          title: 'No llms.txt',
          description:
            'Answer engines increasingly look for /llms.txt: a short markdown file naming what the ' +
            'site is, who it is for, and which pages carry the substance. It is a young convention ' +
            'rather than a requirement, but it is the cheapest way to control how a model summarises ' +
            'a site instead of leaving it to guess from the home page.',
          evidence: { probed: url, status: response.status },
          remediation: 'Publish /llms.txt: an H1 with the site name, a one-line summary, then linked sections.',
          fixPrompt:
            'Create a /llms.txt file at the root of this site, served as text/plain or text/markdown. ' +
            'Structure it as: "# <site name>", a blockquote one-line summary, then "## Docs" / ' +
            '"## About" sections listing the most useful pages as markdown links with a short ' +
            'description each. Keep it under a few hundred lines and link only pages worth quoting.',
        } satisfies Finding,
      ]
    }

    if (/^\s*<(!doctype|html)\b/i.test(response.body)) {
      return [
        {
          checkId: ID,
          category: 'aeo',
          severity: 'low',
          title: 'llms.txt returns an HTML page',
          description:
            `${url} answers 200 with an HTML document rather than markdown — a catch-all route is ` +
            'serving the app shell. Any crawler fetching it gets the page template, so the file reads ' +
            'as present to a status-code check and as meaningless to the thing it was written for.',
          evidence: { url, snippet: response.body.slice(0, 200) },
          remediation: 'Exclude /llms.txt from the catch-all route and serve it as text/plain.',
          fixPrompt:
            'This site serves HTML at /llms.txt because a catch-all or SPA route is intercepting the ' +
            'path. Serve the real markdown file from the static directory instead and exclude that ' +
            'path from the rewrite rules.',
        } satisfies Finding,
      ]
    }

    return []
  },
}
