/**
 * twitter:* card metadata.
 *
 * Scope is deliberately narrow: X falls back to Open Graph tags when no
 * twitter:card is present, so "missing twitter:card" is not a defect — and a
 * page with no social metadata at all is already reported once by the
 * open-graph check. Reporting it twice would double the score penalty for one
 * missing concern.
 *
 * What this check owns is the case OG cannot cover: an explicit twitter:card
 * that is wrong, which silently downgrades the card the site asked for.
 */

import type { Check, Finding } from '../types.ts'
import { metaContents, ogContents } from './meta-tags.ts'

const ID = 'seo.twitter-card'

const VALID_TYPES = new Set(['summary', 'summary_large_image', 'app', 'player'])

export const twitterCardCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'X (Twitter) card',

  run(ctx) {
    const contents = metaContents(ctx, 'twitter:card')
    if (contents.length === 0) return [] // no explicit card → OG fallback applies

    const findings: Finding[] = []
    const cardType = (contents[0] ?? '').toLowerCase()

    if (!cardType) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: 'twitter:card has an empty value',
        description:
          'The page declares <meta name="twitter:card"> with no content, so X cannot tell which card ' +
          'layout to render and falls back to a plain link.',
        remediation: 'Set twitter:card to summary_large_image (or summary for a small thumbnail).',
        fixPrompt:
          'This page renders <meta name="twitter:card"> with an empty content attribute. Set it to ' +
          '"summary_large_image", or remove the tag so the Open Graph tags are used instead.',
      })
      return findings
    }

    if (!VALID_TYPES.has(cardType)) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: `Unknown twitter:card type "${cardType}"`,
        description:
          `"${cardType}" is not one of the card types X recognises (${[...VALID_TYPES].join(', ')}), so ` +
          'the requested layout is ignored and the link renders as plain text.',
        evidence: { cardType },
        remediation: 'Use summary_large_image, summary, app or player.',
        fixPrompt:
          `This page sets <meta name="twitter:card" content="${cardType}">, which is not a valid card ` +
          'type. Change it to "summary_large_image".',
      })
      return findings
    }

    if (cardType === 'summary_large_image') {
      const hasImage = Boolean(metaContents(ctx, 'twitter:image')[0] || ogContents(ctx, 'og:image')[0])
      if (!hasImage) {
        findings.push({
          checkId: ID,
          category: 'seo',
          severity: 'low',
          title: 'summary_large_image card has no image',
          description:
            'The page asks X for the large-image card but supplies neither twitter:image nor og:image. ' +
            'X drops back to a text-only card, so the requested layout never appears.',
          remediation: 'Add twitter:image (or og:image) with an absolute URL, at least 1200×628.',
          fixPrompt:
            'This page requests the summary_large_image X card but provides no image. Add ' +
            '<meta name="twitter:image" content="…"> (absolute URL, ≥1200×628), or set og:image, which ' +
            'X also reads.',
        })
      }
    }

    return findings
  },
}
