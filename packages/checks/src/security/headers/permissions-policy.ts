/**
 * Permissions-Policy — opts the site (and every third-party iframe on it) out
 * of powerful browser features: camera, microphone, geolocation, FLoC-style
 * tracking, etc. Absence is common and not directly exploitable, so this stays
 * an info-level hardening nudge rather than a scary red row.
 */

import type { Check, Finding } from '../../types.ts'

const ID = 'security.headers.permissions-policy'

export const permissionsPolicyCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Permissions-Policy',

  run(ctx) {
    if (ctx.headers.get('permissions-policy')) return []

    return [
      {
        checkId: ID,
        category: 'security',
        severity: 'info',
        title: 'Missing Permissions-Policy',
        description:
          'Without a Permissions-Policy, embedded third-party content inherits access to powerful ' +
          'features (camera, microphone, geolocation) and interest-based tracking stays enabled.',
        remediation:
          'Send a Permissions-Policy disabling the features the site does not use, e.g. ' +
          'camera=(), microphone=(), geolocation=().',
        fixPrompt:
          'Add a Permissions-Policy header to all responses of this site disabling unused browser ' +
          'features. Unless the site uses them, start with: camera=(), microphone=(), geolocation=(), ' +
          'payment=(), usb=(). Configure it alongside the other security headers.',
      } satisfies Finding,
    ]
  },
}
