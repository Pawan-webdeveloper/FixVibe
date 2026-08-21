/**
 * <meta name="viewport"> — without it a mobile browser lays the page out in a
 * ~980px virtual viewport and scales it down, which under mobile-first indexing
 * is what Google sees. That is a genuine ranking and usability problem, hence
 * `high`.
 *
 * A viewport that forbids zooming is an accessibility failure (WCAG 1.4.4), not
 * an SEO one — it is reported here because this is the check that already reads
 * the tag, but at low severity so it does not distort the SEO pillar.
 */

import type { Check, Finding } from '../types.ts'
import { metaContents } from './meta-tags.ts'

const ID = 'seo.viewport'

/** `user-scalable=no`, or a max-scale under 2×, both defeat pinch-zoom. */
const NO_USER_SCALE = /user-scalable\s*=\s*(no|0)\b/i
const MAX_SCALE = /maximum-scale\s*=\s*([0-9.]+)/i

export const viewportCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'Viewport meta tag',

  run(ctx) {
    const contents = metaContents(ctx, 'viewport')
    const content = contents[0] ?? ''

    if (contents.length === 0 || !content) {
      return [
        {
          checkId: ID,
          category: 'seo',
          severity: 'high',
          title: 'Missing viewport meta tag',
          description:
            'No usable <meta name="viewport"> was found. Mobile browsers fall back to a desktop-width ' +
            'virtual viewport and zoom out, and Google indexes that mobile rendering — so the page is ' +
            'ranked on a layout no one designed.',
          evidence: contents.length > 0 ? { content } : undefined,
          remediation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to <head>.',
          fixPrompt:
            'Add <meta name="viewport" content="width=device-width, initial-scale=1" /> inside <head> of ' +
            'this site (in the root layout / base template so every page gets it).',
        } satisfies Finding,
      ]
    }

    const findings: Finding[] = []

    if (!/width\s*=\s*device-width/i.test(content)) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'high',
        title: 'Viewport does not set width=device-width',
        description:
          `The viewport is "${content}", which does not tie layout width to the device. Mobile browsers ` +
          'will still use a virtual viewport, so the responsive CSS breakpoints never engage.',
        evidence: { content },
        remediation: 'Use content="width=device-width, initial-scale=1".',
        fixPrompt:
          `This site's viewport meta tag is "${content}". Change it to ` +
          '"width=device-width, initial-scale=1" so mobile layout matches the device width.',
      })
    }

    const maxScale = Number(MAX_SCALE.exec(content)?.[1])
    const blocksZoom = NO_USER_SCALE.test(content) || (Number.isFinite(maxScale) && maxScale < 2)

    if (blocksZoom) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: 'Viewport blocks pinch-zoom',
        description:
          `The viewport is "${content}". Preventing zoom fails WCAG 1.4.4 (Resize Text) and makes small ` +
          'text unreadable for anyone who needs to magnify it. iOS has ignored this since iOS 10; ' +
          'Android still honours it.',
        evidence: { content },
        remediation: 'Remove user-scalable=no and any maximum-scale below 2 from the viewport tag.',
        fixPrompt:
          `This site's viewport meta tag is "${content}". Remove the zoom restrictions ` +
          '(user-scalable / maximum-scale) so it reads "width=device-width, initial-scale=1".',
      })
    }

    return findings
  },
}
