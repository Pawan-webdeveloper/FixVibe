/**
 * Indexing directives — the highest-stakes check in the SEO pillar.
 *
 * A `noindex` left over from staging removes the page from Google entirely, and
 * the site looks completely healthy otherwise: it renders, it ranks nothing.
 * Three sources can carry it and any one is enough, so all three are read:
 * <meta name="robots">, <meta name="googlebot">, and the X-Robots-Tag response
 * header (which wins over both).
 *
 * All sources collapse into ONE finding. Reporting three would triple the score
 * penalty for what is a single misconfiguration with a single fix.
 */

import type { Check, Finding } from '../types.ts'
import { metaContents } from './meta-tags.ts'

const ID = 'seo.robots-meta'

/** `none` is shorthand for "noindex, nofollow" — treating it as index-safe is a real miss. */
const NOINDEX = /\b(noindex|none)\b/i
const NOFOLLOW = /\b(nofollow|none)\b/i

interface Directive {
  source: string
  value: string
}

export const robotsMetaCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'Indexing directives',

  run(ctx) {
    const directives: Directive[] = [
      ...metaContents(ctx, 'robots').map((value) => ({ source: 'meta[name=robots]', value })),
      ...metaContents(ctx, 'googlebot').map((value) => ({ source: 'meta[name=googlebot]', value })),
    ]

    // Headers joins repeated X-Robots-Tag values with ", " — matching per header
    // line keeps the evidence readable when a CDN adds its own.
    const header = ctx.headers.get('x-robots-tag')
    if (header) directives.push({ source: 'X-Robots-Tag', value: header })

    const findings: Finding[] = []
    const noindex = directives.filter((d) => NOINDEX.test(d.value))
    const nofollow = directives.filter((d) => NOFOLLOW.test(d.value))

    if (noindex.length > 0) {
      const sources = noindex.map((d) => `${d.source}: "${d.value}"`)
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'critical',
        title: 'Page is marked noindex',
        description:
          `This page tells crawlers not to index it (${sources.join('; ')}). Google will drop it from ` +
          'search results entirely. This is correct for login, checkout and thank-you pages, and a ' +
          'catastrophe anywhere else — it is the most common cause of a site vanishing from search ' +
          'after a deploy, usually inherited from a staging environment.',
        evidence: { sources: noindex },
        remediation:
          'If this page should rank, remove the noindex directive from the tag or header emitting it. ' +
          'If it should not be indexed, no change is needed.',
        fixPrompt:
          `This page emits a noindex directive (${sources.join('; ')}). Unless the page is deliberately ` +
          'excluded from search, remove that directive. Check both the HTML head templates and any ' +
          'server/CDN header rules (Next.js headers(), nginx add_header, vercel.json, Cloudflare ' +
          'transform rules), and make sure the value is not driven by a staging-only environment flag ' +
          'that leaked into production.',
      })
    }

    if (nofollow.length > 0 && noindex.length === 0) {
      const sources = nofollow.map((d) => `${d.source}: "${d.value}"`)
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'info',
        title: 'Page is marked nofollow',
        description:
          `This page tells crawlers not to follow its links (${sources.join('; ')}). Pages linked only ` +
          'from here lose their discovery path. Intentional on user-generated content; rarely intended ' +
          'on a normal page.',
        evidence: { sources: nofollow },
        remediation: 'Remove nofollow unless this page hosts untrusted user-submitted links.',
        fixPrompt:
          `This page emits a nofollow directive (${sources.join('; ')}). Unless it hosts untrusted ` +
          'user-generated links, remove nofollow so crawlers can follow the links on it.',
      })
    }

    return findings
  },
}
