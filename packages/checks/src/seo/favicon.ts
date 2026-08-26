/**
 * A favicon, declared or at the conventional path.
 *
 * Small, but it is the site's mark in a tab strip, a bookmark bar and a search
 * result. Its absence is also a reliable sign of a deploy that never got a
 * final pass, which is why it is worth one line in a report.
 *
 * Browsers fall back to /favicon.ico when no <link> declares one, so markup
 * alone cannot answer this — a site with no link tag and a real favicon.ico is
 * perfectly fine. The probe is only spent when the markup is silent.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'seo.favicon'

const ICON_RELS = ['icon', 'shortcut icon', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'mask-icon']

export const faviconCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'Favicon',

  async run(ctx) {
    const declared = ctx
      .$('link[href]')
      .toArray()
      .some((el) => {
        // rel is a case-insensitive token set; "shortcut icon" is two tokens.
        const rel = (ctx.$(el).attr('rel') ?? '').trim().toLowerCase()
        return ICON_RELS.includes(rel) || rel.split(/\s+/).includes('icon')
      })

    if (declared) return []

    const response = await ctx.probe('/favicon.ico')
    // null is "we could not ask", and a 200 is the browser's fallback working.
    if (!response || response.status === 200) return []

    return [
      {
        checkId: ID,
        category: 'seo',
        severity: 'info',
        title: 'No favicon',
        description:
          'No <link rel="icon"> in the markup, and /favicon.ico answered ' +
          `${response.status}. Browsers will show a generic placeholder in the tab, the bookmark bar ` +
          'and anywhere the site is listed alongside others.',
        evidence: { probed: new URL('/favicon.ico', ctx.finalUrl).href, status: response.status },
        remediation: 'Add a favicon and declare it with <link rel="icon">.',
        fixPrompt:
          'This site has no favicon. Add one — an SVG plus a 180×180 PNG for apple-touch-icon covers ' +
          'every current browser — and declare both with <link rel="icon"> in the root layout. In ' +
          'Next.js an icon file placed in app/ is picked up automatically.',
      } satisfies Finding,
    ]
  },
}
