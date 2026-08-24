/**
 * A reachable privacy policy.
 *
 * Required wherever personal data is collected — GDPR Article 13, CCPA, and the
 * app store rules most products eventually meet. It is also the page users look
 * for when deciding whether to trust a form, so its absence costs conversions
 * as well as compliance.
 *
 * Matched on the link's destination and its text, both of which are visible in
 * the HTML. A policy that exists but is unreachable from the home page is
 * indistinguishable from one that does not exist — for a user and for a
 * regulator alike — so it is treated the same way.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'compliance.privacy-policy-link'

const PRIVACY_HREF = /(privacy|datenschutz|confidentialite|privacidad|gizlilik|politique-de-confidentialite)/i
const PRIVACY_TEXT = /\b(privacy|data protection|datenschutz|confidentialit|privacidad)/i

export const privacyPolicyLinkCheck: Check = {
  id: ID,
  category: 'compliance',
  title: 'Privacy policy link',

  run(ctx) {
    const links = ctx.$('a[href]').toArray()

    const found = links.some((el) => {
      const link = ctx.$(el)
      const href = link.attr('href') ?? ''
      const text = link.text().replace(/\s+/g, ' ').trim()
      const label = link.attr('aria-label') ?? ''
      return PRIVACY_HREF.test(href) || PRIVACY_TEXT.test(text) || PRIVACY_TEXT.test(label)
    })

    if (found) return []

    // A page with no links at all is a holding page, not a product with a
    // missing policy; saying anything there would be noise.
    if (links.length < 3) return []

    return [
      {
        checkId: ID,
        category: 'compliance',
        severity: 'low',
        title: 'No link to a privacy policy',
        description:
          `None of the ${links.length} links on this page points to a privacy policy, by URL or by ` +
          'wording. Wherever personal data is collected — a contact form, analytics, an account — one ' +
          'is required and has to be reachable. It is also the page a visitor looks for before ' +
          'deciding to trust a form, so a missing one costs sign-ups as well as compliance.',
        evidence: { linksOnPage: links.length },
        remediation: 'Publish a privacy policy and link it from the site footer.',
        fixPrompt:
          'This site has no link to a privacy policy. Add one to the global footer so it is reachable ' +
          'from every page. The policy needs to state what personal data is collected, why, who it is ' +
          'shared with, how long it is kept, and how to request deletion — for analytics and any ' +
          'third-party service in use, named. If a policy already exists but is only linked from one ' +
          'page, move the link into the shared layout.',
      } satisfies Finding,
    ]
  },
}
