/**
 * Domain registration expiry, from RDAP.
 *
 * A lapsed domain is worse than an outage. DNS stops resolving, so the site
 * and every mailbox on it go dark at once; and once the redemption period ends
 * anyone may register the name, at which point they receive the mail, can pass
 * the email-based validation every CA uses, and can issue a valid certificate
 * for it. Recovery ranges from an expensive phone call to impossible.
 *
 * The date comes from the registry over RDAP, which is authoritative when it
 * answers and silent when it does not: plenty of ccTLD registries publish no
 * RDAP endpoint, and others withhold dates by policy. `registration` is null
 * in those cases and this check says nothing — "expiry unknown" is not a
 * finding about the domain.
 *
 * Auto-renew is deliberately not assumed. RDAP does not expose it, an expired
 * card silently disables it, and "it's on auto-renew" is the sentence people
 * say right before a domain lapses.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'security.domain.expiry'
const DAY_MS = 86_400_000

/**
 * Thresholds mirror the TLS certificate check (expired → critical, ≤7 → high,
 * ≤30 → medium) but start later. Certificates renew on a 60–90 day cycle so 30
 * days out is routine; registrations renew yearly, so a domain inside 30 days
 * is either about to be renewed or about to be lost, and it is worth one line
 * in a report to find out which.
 */
export const domainExpiryCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Domain registration expiry',

  run(ctx) {
    const registration = ctx.dns.registration
    if (!registration?.expiresAt) return []

    const expiresAt = new Date(registration.expiresAt)
    // A date we cannot read is not a date we should report on.
    if (Number.isNaN(expiresAt.getTime())) return []

    const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / DAY_MS)
    if (daysLeft > 30) return []

    const domain = ctx.dns.emailDomain ?? ctx.finalUrl.hostname
    const evidence = {
      domain,
      expiresAt: expiresAt.toISOString(),
      daysLeft,
      registrar: registration.registrar,
      source: 'RDAP',
    }
    const where = registration.registrar ? ` at ${registration.registrar}` : ''

    if (daysLeft < 0) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'critical',
          title: `Domain registration expired ${-daysLeft} day(s) ago`,
          description:
            `The registry reports that ${domain} expired on ${expiresAt.toISOString().slice(0, 10)}. ` +
            'Registrars usually park an expired domain for a grace period before deleting it, so the ' +
            'site may still resolve today. When that period ends the name is released and anyone may ' +
            'register it — and whoever does receives the mail for this domain, which is enough to pass ' +
            'the validation most Certificate Authorities use to issue a certificate for it.',
          evidence,
          remediation: `Renew ${domain} immediately${where}, before the redemption period ends.`,
          fixPrompt:
            `The domain ${domain} expired on ${expiresAt.toISOString().slice(0, 10)} according to RDAP. ` +
            'This is not a code change — log in to the registrar' +
            (registration.registrar ? ` (${registration.registrar})` : '') +
            ' and renew it now. Then fix the reason it lapsed: update the payment method, enable ' +
            'auto-renew, and point the registrar\'s notification address at a mailbox that is NOT ' +
            'hosted on this domain, since that mailbox stops working the moment the domain does.',
        } satisfies Finding,
      ]
    }

    return [
      {
        checkId: ID,
        category: 'security',
        severity: daysLeft <= 7 ? 'high' : 'medium',
        title: `Domain registration expires in ${daysLeft} day(s)`,
        description:
          `The registry reports that ${domain} expires on ${expiresAt.toISOString().slice(0, 10)}. ` +
          'If it lapses, DNS stops answering and the website and every mailbox on the domain go down ' +
          'together — including the mailbox the registrar sends renewal warnings to. Auto-renew ' +
          'covers this only while the card on file is still valid, which is not something the ' +
          'registry publishes.',
        evidence,
        remediation: `Confirm auto-renew and a valid payment method for ${domain}${where}, or renew it now.`,
        fixPrompt:
          `The domain ${domain} expires in ${daysLeft} day(s), on ` +
          `${expiresAt.toISOString().slice(0, 10)}. This is not a code change — at the registrar` +
          (registration.registrar ? ` (${registration.registrar})` : '') +
          ', confirm auto-renew is on and the payment method on file has not expired, or renew ' +
          'manually. Set the registrar\'s contact address to a mailbox hosted somewhere other than ' +
          'this domain, so renewal warnings still arrive if the domain ever does lapse.',
      } satisfies Finding,
    ]
  },
}
