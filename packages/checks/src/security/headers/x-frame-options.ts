/**
 * Clickjacking protection. The modern control is CSP frame-ancestors — but
 * ONLY when delivered as a header: the spec ignores frame-ancestors in <meta>
 * CSPs, so a meta-only policy must not silence this check. For X-Frame-Options
 * we mirror the HTML Standard's algorithm: values are split on commas into a
 * set of unique tokens, so the very common "server + framework both set
 * SAMEORIGIN" duplication is valid, and CONFLICTING values fail closed
 * (framing blocked) — a config-hygiene note, not a vulnerability.
 */

import type { Check, Finding } from '../../types.ts'
import { getCspPolicies, parseCsp } from './csp.ts'

const ID = 'security.headers.x-frame-options'

export const xFrameOptionsCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Clickjacking protection (X-Frame-Options / frame-ancestors)',

  run(ctx) {
    // Header-delivered policies only — browsers ignore frame-ancestors in <meta>.
    const headerPolicies = getCspPolicies(ctx).header
    if (headerPolicies.some((policy) => parseCsp(policy).has('frame-ancestors'))) return []

    const header = ctx.headers.get('x-frame-options')
    if (header) {
      // Repeated headers arrive comma-joined; browsers evaluate the SET of values.
      const tokens = [...new Set(header.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean))]

      if (tokens.length === 1 && (tokens[0] === 'DENY' || tokens[0] === 'SAMEORIGIN')) return []

      if (tokens.length > 1) {
        return [
          {
            checkId: ID,
            category: 'security',
            severity: 'low',
            title: 'Conflicting X-Frame-Options values',
            description:
              `Multiple different X-Frame-Options values are sent (${tokens.join(', ')}). Browsers ` +
              'fail closed and block framing entirely, so the page is protected — but the intent is ' +
              'ambiguous and one layer of the stack is misconfigured.',
            evidence: { header },
            remediation:
              'Send exactly one X-Frame-Options value from one place (server config or middleware, ' +
              'not both).',
            fixPrompt:
              `This site sends conflicting X-Frame-Options values: "${header}". Find the two places ` +
              'setting it (typically web server config plus framework middleware) and remove one, ' +
              'keeping a single DENY or SAMEORIGIN.',
          } satisfies Finding,
        ]
      }

      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'medium',
          title: 'X-Frame-Options has an ineffective value',
          description:
            `X-Frame-Options is "${header}", which browsers do not recognise as a framing restriction — ` +
            'the page can still be embedded in a hostile iframe and clickjacked.',
          evidence: { header },
          remediation:
            "Use X-Frame-Options: DENY (or SAMEORIGIN), or better, CSP frame-ancestors 'none'/'self'.",
          fixPrompt:
            `This site sends X-Frame-Options: ${header}, which is not a valid value. Replace it with ` +
            'DENY (or SAMEORIGIN if the site frames itself), and add frame-ancestors to the ' +
            'Content-Security-Policy with the same meaning.',
        } satisfies Finding,
      ]
    }

    return [
      {
        checkId: ID,
        category: 'security',
        severity: 'medium',
        title: 'No clickjacking protection',
        description:
          'Neither CSP frame-ancestors (header) nor X-Frame-Options is set, so any site can embed ' +
          'this page in an invisible iframe and trick users into clicking its buttons (clickjacking).',
        remediation:
          "Add frame-ancestors 'none' (or 'self') to the Content-Security-Policy header; keep " +
          'X-Frame-Options: DENY for older browsers.',
        fixPrompt:
          "Add clickjacking protection to this site: send Content-Security-Policy with frame-ancestors " +
          "'none' (use 'self' if the site legitimately embeds its own pages) and X-Frame-Options: DENY " +
          'on all HTML responses, configured in the web server or framework middleware — as headers, ' +
          'not <meta> tags (frame-ancestors is ignored in meta CSPs).',
      } satisfies Finding,
    ]
  },
}
