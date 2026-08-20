/**
 * Strict-Transport-Security — instructs browsers to refuse plain HTTP for this
 * host, closing the SSL-stripping window on every visit after the first.
 * Only meaningful when the site is actually served over HTTPS (browsers ignore
 * HSTS on http:// responses, so we skip entirely there — the https-redirect
 * check owns that problem).
 */

import type { Check, Finding } from '../../types.ts'

const ID = 'security.headers.hsts'

/** Six months — below this, browsers and preload lists consider the pin too weak. */
const MIN_MAX_AGE_SECONDS = 15_552_000

export const hstsCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Strict-Transport-Security',

  run(ctx) {
    if (ctx.finalUrl.protocol !== 'https:') return []

    const header = ctx.headers.get('strict-transport-security')
    if (!header) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'medium',
          title: 'Missing Strict-Transport-Security',
          description:
            'Without HSTS the browser will still try plain HTTP on direct visits and typed URLs, ' +
            'leaving users open to SSL-stripping on hostile networks.',
          remediation:
            'Send Strict-Transport-Security: max-age=31536000; includeSubDomains on all HTTPS responses.',
          fixPrompt:
            'Add a Strict-Transport-Security header to all HTTPS responses of this site: ' +
            '"max-age=31536000; includeSubDomains". Configure it where other response headers are set ' +
            '(web server config or framework middleware). Confirm every subdomain is HTTPS-ready before ' +
            'shipping includeSubDomains.',
        } satisfies Finding,
      ]
    }

    const maxAgeMatch = header.match(/max-age\s*=\s*"?(\d+)/i)
    const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : null

    if (maxAge === null || maxAge === 0) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'medium',
          title: maxAge === 0 ? 'HSTS is disabled (max-age=0)' : 'HSTS header has no max-age',
          description:
            maxAge === 0
              ? 'max-age=0 tells browsers to delete the HSTS pin, actively switching the protection off.'
              : 'Without a valid max-age directive the HSTS header is ignored by browsers.',
          evidence: { header },
          remediation: 'Set max-age to at least 15552000 (180 days); 31536000 is the common choice.',
          fixPrompt:
            'Fix the Strict-Transport-Security header on this site: it currently has a missing or zero ' +
            'max-age. Change it to "max-age=31536000; includeSubDomains".',
        } satisfies Finding,
      ]
    }

    if (maxAge < MIN_MAX_AGE_SECONDS) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'low',
          title: 'HSTS max-age is shorter than 180 days',
          description:
            'A short max-age means the protection expires between infrequent visits, reopening the ' +
            'SSL-stripping window it was meant to close.',
          evidence: { header, maxAgeSeconds: maxAge },
          remediation: 'Raise max-age to at least 15552000 (180 days).',
          fixPrompt:
            `This site's Strict-Transport-Security max-age is ${maxAge} seconds. Raise it to 31536000 ` +
            'and keep any existing includeSubDomains/preload directives.',
        } satisfies Finding,
      ]
    }

    return []
  },
}
