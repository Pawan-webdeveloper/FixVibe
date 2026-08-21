/**
 * Open Graph — what a link to this page looks like when someone pastes it into
 * Slack, WhatsApp, LinkedIn, Discord or iMessage. It has nothing to do with
 * ranking, so severities stay low: this is conversion surface, not search
 * position.
 *
 * A page with no OG tags at all gets ONE finding rather than five, so a plain
 * site does not have its SEO score shredded by a single missing concern.
 */

import type { Check, Finding } from '../types.ts'
import { ogContents } from './meta-tags.ts'

const ID = 'seo.open-graph'

/** The tags that actually change the rendered preview card. */
const REQUIRED = [
  { property: 'og:title', why: 'the bold headline of the preview card' },
  { property: 'og:description', why: 'the grey supporting line under the headline' },
  { property: 'og:image', why: 'the image; without it most platforms render a bare text link' },
] as const

export const openGraphCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'Open Graph tags',

  run(ctx) {
    const present = new Map(REQUIRED.map(({ property }) => [property, ogContents(ctx, property)[0] ?? '']))
    const missing = REQUIRED.filter(({ property }) => !present.get(property))

    if (missing.length === REQUIRED.length) {
      return [
        {
          checkId: ID,
          category: 'seo',
          severity: 'low',
          title: 'No Open Graph tags',
          description:
            'The page has no og:title, og:description or og:image. Shared links render as a bare URL ' +
            'with scraped text and no image on Slack, WhatsApp, LinkedIn, Discord and iMessage.',
          remediation: 'Add og:title, og:description and og:image (≥1200×630) to <head>.',
          fixPrompt:
            'Add Open Graph meta tags to this site\'s <head>: og:title, og:description, og:image ' +
            '(absolute URL, at least 1200×630), og:url and og:type. Generate them per page from the same ' +
            'data as the page title and meta description rather than hardcoding one set in the layout.',
        } satisfies Finding,
      ]
    }

    const findings: Finding[] = []

    for (const { property, why } of missing) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'info',
        title: `Missing ${property}`,
        description: `The page sets some Open Graph tags but not ${property} — ${why}.`,
        evidence: { present: Object.fromEntries([...present].filter(([, value]) => value)) },
        remediation: `Add <meta property="${property}" content="…"> alongside the existing OG tags.`,
        fixPrompt:
          `This page has Open Graph tags but is missing ${property}. Add it next to the existing ones, ` +
          'populated from the same page data.',
      })
    }

    const image = present.get('og:image') ?? ''
    if (image && !/^https?:\/\//i.test(image)) {
      const absolute = safeAbsolute(image, ctx.finalUrl)
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: 'og:image is not an absolute URL',
        description:
          `og:image is "${image}". Link previewers fetch this URL from their own servers with no page ` +
          'context, so a relative or protocol-relative path resolves to nothing and the card renders ' +
          'without an image.',
        evidence: { ogImage: image, resolved: absolute },
        remediation: 'Emit og:image as a full absolute URL including the https:// scheme and host.',
        fixPrompt:
          `This page's og:image is "${image}", which is not absolute. Prefix it with the site's origin ` +
          `so it reads "${absolute ?? 'https://your-domain.example/path/to/image.png'}", and do the same ` +
          'wherever og:image is generated.',
      })
    }

    return findings
  },
}

function safeAbsolute(value: string, base: URL): string | null {
  try {
    return new URL(value, base).href
  } catch {
    return null
  }
}
