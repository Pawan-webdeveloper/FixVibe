/**
 * X-Content-Type-Options: nosniff — stops browsers second-guessing
 * Content-Type. Without it, a user-uploaded "image" that is really HTML/JS can
 * be sniffed into executing. One valid value exists, so this check is binary.
 */

import type { Check, Finding } from '../../types.ts'

const ID = 'security.headers.x-content-type-options'

export const xContentTypeOptionsCheck: Check = {
  id: ID,
  category: 'security',
  title: 'X-Content-Type-Options',

  run(ctx) {
    const header = ctx.headers.get('x-content-type-options')
    if (header?.trim().toLowerCase() === 'nosniff') return []

    return [
      {
        checkId: ID,
        category: 'security',
        severity: 'low',
        title: header ? 'X-Content-Type-Options has an invalid value' : 'Missing X-Content-Type-Options',
        description:
          'Without "nosniff" browsers may MIME-sniff responses, which can turn mislabelled or ' +
          'user-uploaded content into executable script.',
        ...(header ? { evidence: { header } } : {}),
        remediation: 'Send X-Content-Type-Options: nosniff on every response.',
        fixPrompt:
          'Add the header X-Content-Type-Options: nosniff to all responses of this site, in the web ' +
          'server config or framework middleware where other security headers are set.',
      } satisfies Finding,
    ]
  },
}
