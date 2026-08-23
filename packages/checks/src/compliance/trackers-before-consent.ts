/**
 * Tracking that starts before anyone could have agreed to it.
 *
 * Under GDPR and the ePrivacy Directive, analytics and advertising cookies need
 * consent BEFORE they are set — not a banner shown while the tracker is already
 * running. This is the most-enforced failure in the whole area precisely
 * because it is trivially observable from outside: fetch the page once, with no
 * interaction, and see what loaded and what was stored.
 *
 * Which is exactly what this does. Everything reported was in the very first
 * response, where no consent can have been given.
 *
 * What it cannot know, and says so: where the visitors are, and whether the
 * operator has some other lawful basis. So this is framed as the thing that
 * matters IF the site has European visitors, rather than as a verdict.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'compliance.trackers-before-consent'

/** Hosts whose only purpose is analytics or advertising. */
const TRACKER_HOSTS: ReadonlyArray<{ host: string; name: string }> = [
  { host: 'google-analytics.com', name: 'Google Analytics' },
  { host: 'googletagmanager.com', name: 'Google Tag Manager' },
  { host: 'googlesyndication.com', name: 'Google Ads' },
  { host: 'doubleclick.net', name: 'Google DoubleClick' },
  { host: 'connect.facebook.net', name: 'Meta Pixel' },
  { host: 'facebook.net', name: 'Meta Pixel' },
  { host: 'hotjar.com', name: 'Hotjar' },
  { host: 'clarity.ms', name: 'Microsoft Clarity' },
  { host: 'fullstory.com', name: 'FullStory' },
  { host: 'mixpanel.com', name: 'Mixpanel' },
  { host: 'amplitude.com', name: 'Amplitude' },
  { host: 'segment.com', name: 'Segment' },
  { host: 'segment.io', name: 'Segment' },
  { host: 'matomo.cloud', name: 'Matomo' },
  { host: 'ads-twitter.com', name: 'X Ads' },
  { host: 'licdn.com', name: 'LinkedIn Insight' },
  { host: 'tiktok.com', name: 'TikTok Pixel' },
]

/** Cookie names these services set. Prefix-matched, because most are versioned. */
const TRACKING_COOKIES = ['_ga', '_gid', '_gat', '_gcl_', '_fbp', '_fbc', '_hj', '_uetsid', 'MUID', 'IDE', 'ajs_']

export const trackersBeforeConsentCheck: Check = {
  id: ID,
  category: 'compliance',
  title: 'Tracking before consent',

  run(ctx) {
    const services = new Set<string>()

    for (const script of ctx.scripts) {
      if (!script.url) continue
      let host: string
      try {
        host = new URL(script.url).hostname.toLowerCase()
      } catch {
        continue
      }
      for (const tracker of TRACKER_HOSTS) {
        if (host === tracker.host || host.endsWith(`.${tracker.host}`)) services.add(tracker.name)
      }
    }

    const cookies = ctx.cookies
      .map((cookie) => cookie.name)
      .filter((name) => TRACKING_COOKIES.some((prefix) => name.startsWith(prefix)))

    if (services.size === 0 && cookies.length === 0) return []

    const loaded = [...services]

    return [
      {
        checkId: ID,
        category: 'compliance',
        // A cookie already stored is the completed act; a script merely loaded
        // is the setup for it, and often still gated in the client.
        severity: cookies.length > 0 ? 'medium' : 'low',
        title:
          cookies.length > 0
            ? 'Tracking cookies are set on the first visit'
            : `${loaded.length} tracking service${loaded.length === 1 ? '' : 's'} load before any consent`,
        description:
          (loaded.length > 0 ? `The first response loads ${loaded.join(', ')}. ` : '') +
          (cookies.length > 0
            ? `It also sets ${cookies.join(', ')} — cookies stored before the page was even ` +
              'interacted with, so no consent can have preceded them. '
            : '') +
          'Under GDPR and ePrivacy, analytics and advertising storage needs consent first, and this ' +
          'is the failure regulators act on most because it is visible from a single request. Whether ' +
          'it applies depends on where the visitors are and on the lawful basis claimed, neither of ' +
          'which is visible from outside.',
        evidence: { services: loaded, cookiesSet: cookies },
        remediation:
          'Load tracking scripts only after consent is recorded, rather than showing a banner beside ' +
          'a tracker that is already running.',
        fixPrompt:
          'This site starts tracking on the first response, before consent: ' +
          `${[...loaded, ...cookies].join(', ')}.\n\n` +
          'Move the loading itself behind consent, not just the banner. Concretely: do not render the ' +
          'analytics <script> tag at all on first paint; inject it from the consent callback once a ' +
          'positive choice is stored. With Google Tag Manager use Consent Mode v2 with denied ' +
          'defaults. Then re-test the way a regulator would — open the page in a clean profile, take ' +
          'no action, and check that no analytics request went out and no _ga/_fbp cookie exists.',
      } satisfies Finding,
    ]
  },
}
