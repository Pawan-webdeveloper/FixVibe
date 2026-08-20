/**
 * Certificate expiry — the one security failure every visitor sees. Browsers
 * hard-block expired certificates, so severity scales with time left:
 *   expired → critical, ≤14 days → high, ≤30 days → medium.
 * ctx.tls === null means the handshake could not be inspected (plain-HTTP site
 * or broken TLS stack) — that is a skip here, never a finding; tls.ts owns it.
 */

import type { Check, Finding } from '../../types.ts'

const ID = 'security.tls.cert-expiry'

const DAY_MS = 86_400_000

export const certExpiryCheck: Check = {
  id: ID,
  category: 'security',
  title: 'TLS certificate expiry',

  run(ctx) {
    if (!ctx.tls) return []

    const { validTo, issuer } = ctx.tls
    if (Number.isNaN(validTo.getTime())) return [] // unparseable valid_to → can't judge, don't guess

    const daysLeft = Math.floor((validTo.getTime() - Date.now()) / DAY_MS)
    if (daysLeft > 30) return []

    const evidence = { validTo: validTo.toISOString(), issuer, daysLeft }
    const renewNow =
      'Renew the TLS certificate now. If the host supports it, switch to an auto-renewing ' +
      "source (Let's Encrypt / the platform's managed certificates) so this cannot recur."

    if (daysLeft < 0) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'critical',
          title: 'TLS certificate has expired',
          description:
            `The certificate expired ${-daysLeft} day(s) ago. Browsers show a full-page security ` +
            'error and refuse the connection — for most visitors the site is down.',
          evidence,
          remediation: renewNow,
          fixPrompt:
            'The TLS certificate for this site has expired. Identify how certificates are issued ' +
            '(hosting platform, Let’s Encrypt/certbot, or a paid CA), renew it immediately, and set up ' +
            'automated renewal with an expiry alert at 30 days.',
        } satisfies Finding,
      ]
    }

    return [
      {
        checkId: ID,
        category: 'security',
        severity: daysLeft <= 14 ? 'high' : 'medium',
        title: `TLS certificate expires in ${daysLeft} day(s)`,
        description:
          'When it lapses, browsers will hard-block the site with a security error. ' +
          'Certificates this close to expiry usually mean auto-renewal is not set up or is failing.',
        evidence,
        remediation: renewNow,
        fixPrompt:
          `This site's TLS certificate expires in ${daysLeft} day(s). Renew it and configure automated ` +
          'renewal (e.g. certbot timer or the hosting platform’s managed TLS), then verify the renewal ' +
          'job actually ran.',
      } satisfies Finding,
    ]
  },
}
