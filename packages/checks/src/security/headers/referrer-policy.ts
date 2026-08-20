/**
 * Referrer-Policy — controls how much of the current URL leaks to other sites
 * via the Referer header. The browser default (strict-origin-when-cross-origin)
 * is decent, so a missing header is only a hardening hint; an explicitly leaky
 * policy is worse because someone chose it.
 */

import type { Check, Finding } from '../../types.ts'

const ID = 'security.headers.referrer-policy'

/** Policies that ship the full path/query cross-origin — the thing this header exists to stop. */
const LEAKY_POLICIES = new Set(['unsafe-url', 'no-referrer-when-downgrade'])

/** The complete token set from the Referrer Policy spec — anything else is ignored by browsers. */
const KNOWN_POLICIES = new Set([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
])

export const referrerPolicyCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Referrer-Policy',

  run(ctx) {
    const header = ctx.headers.get('referrer-policy')

    if (!header) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'low',
          title: 'Missing Referrer-Policy',
          description:
            'No explicit Referrer-Policy is set. Modern browsers default to a safe policy, but older ' +
            'ones sent full URLs — including path and query strings — to every site a user clicks to.',
          remediation: 'Send Referrer-Policy: strict-origin-when-cross-origin (or stricter).',
          fixPrompt:
            'Add the header Referrer-Policy: strict-origin-when-cross-origin to all responses of this ' +
            'site, next to the other security headers in the server config or middleware.',
        } satisfies Finding,
      ]
    }

    // A comma-separated list is allowed; per spec the last RECOGNISED policy
    // wins — an unknown trailing token must not hide a leaky one before it.
    const tokens = header.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean)
    const effective = tokens.findLast((t) => KNOWN_POLICIES.has(t))

    if (!effective) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'low',
          title: 'Referrer-Policy value is not recognised',
          description:
            `The header is set to "${header}", which contains no valid policy token — browsers ignore ` +
            'it and fall back to their default, so the header is not doing what its author intended.',
          evidence: { header },
          remediation: 'Use a valid token, e.g. strict-origin-when-cross-origin.',
          fixPrompt:
            `This site's Referrer-Policy header ("${header}") has no valid policy token. Replace it ` +
            'with strict-origin-when-cross-origin wherever response headers are configured.',
        } satisfies Finding,
      ]
    }

    if (LEAKY_POLICIES.has(effective)) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'medium',
          title: `Leaky Referrer-Policy: ${effective}`,
          description:
            'This policy sends the full page URL (path and query included) to other origins. URLs ' +
            'often carry tokens, search terms and IDs — all of it lands in third-party logs.',
          evidence: { header },
          remediation: 'Switch to strict-origin-when-cross-origin, strict-origin, or no-referrer.',
          fixPrompt:
            `Change this site's Referrer-Policy header from "${header}" to ` +
            'strict-origin-when-cross-origin wherever response headers are configured.',
        } satisfies Finding,
      ]
    }

    return []
  },
}
