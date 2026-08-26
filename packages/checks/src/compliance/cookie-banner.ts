/**
 * Whether a site running trackers has any consent mechanism at all.
 *
 * Scoped so it only speaks when the question exists: a site with no tracking
 * has nothing to ask consent for, and telling it to add a cookie banner would
 * be advising a worse experience for no legal benefit. Plenty of good sites
 * correctly have no banner.
 *
 * Detection is a heuristic and the severity says so. Consent platforms are
 * recognisable by the scripts they load, and hand-rolled banners by the names
 * they give their markup — but a banner rendered entirely by client JavaScript
 * is invisible to a scan of the HTML. So this reports at info: absent evidence
 * of consent UI, not evidence of its absence.
 *
 * trackers-before-consent covers the case that is actually measurable — storage
 * that already happened.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'compliance.cookie-banner'

/** Consent platforms, identified by the host their tag loads from. */
const CMP_HOSTS = [
  'cookielaw.org',
  'onetrust.com',
  'cookiebot.com',
  'cookieyes.com',
  'osano.com',
  'usercentrics.eu',
  'iubenda.com',
  'termly.io',
  'quantcast.com',
  'didomi.io',
  'trustarc.com',
  'klaro',
]

/** What a hand-rolled banner tends to call itself. */
const MARKUP_HINTS = /(cookie[-_]?(banner|consent|notice|bar|policy)|consent[-_]?(banner|manager|modal)|gdpr|cmp[-_]?container)/i

const TRACKER_HOSTS = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'connect.facebook.net',
  'hotjar.com',
  'clarity.ms',
  'segment.com',
  'mixpanel.com',
]

export const cookieBannerCheck: Check = {
  id: ID,
  category: 'compliance',
  title: 'Consent mechanism',

  run(ctx) {
    const scriptHosts = ctx.scripts.flatMap((script) => {
      if (!script.url) return []
      try {
        return [new URL(script.url).hostname.toLowerCase()]
      } catch {
        return []
      }
    })

    const tracks = scriptHosts.some((host) => TRACKER_HOSTS.some((t) => host === t || host.endsWith(`.${t}`)))
    if (!tracks) return [] // nothing to consent to

    const hasCmp = scriptHosts.some((host) => CMP_HOSTS.some((cmp) => host.includes(cmp)))
    if (hasCmp) return []

    // Attribute values are where a hand-rolled banner names itself; scanning
    // whole-document text would match the phrase "cookie policy" in a footer.
    const markup = ctx
      .$('[id], [class]')
      .toArray()
      .map((el) => `${ctx.$(el).attr('id') ?? ''} ${ctx.$(el).attr('class') ?? ''}`)
      .join(' ')

    if (MARKUP_HINTS.test(markup)) return []

    return [
      {
        checkId: ID,
        category: 'compliance',
        severity: 'info',
        title: 'Tracking is present with no consent mechanism found',
        description:
          'This page loads tracking scripts, and the HTML contains neither a known consent platform ' +
          'nor any markup that names itself a cookie banner. Worth confirming rather than acting on ' +
          'directly: a banner rendered entirely in client JavaScript would not appear in the HTML a ' +
          'scan reads, so this is absent evidence rather than evidence of absence.',
        evidence: { trackerHosts: [...new Set(scriptHosts)].slice(0, 8) },
        remediation:
          'If the site has EU or UK visitors, add a consent mechanism that gates the trackers rather ' +
          'than merely announcing them.',
        fixPrompt:
          'This site loads tracking scripts and no consent UI was found in its HTML. First confirm ' +
          'whether one is rendered client-side — if so, nothing is wrong. If not, and the site has ' +
          'European visitors, add a consent mechanism and make it GATE the trackers: the requirement ' +
          'is that nothing analytical loads or stores until a positive choice is recorded, and a ' +
          'banner sitting beside a tracker that is already running satisfies nobody.',
      } satisfies Finding,
    ]
  },
}
