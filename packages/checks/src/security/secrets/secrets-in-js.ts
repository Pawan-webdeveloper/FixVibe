/**
 * Credentials compiled into the JavaScript the browser downloads.
 *
 * The usual cause is a build-time environment variable that should have stayed
 * on the server: a `.env` value read in client code, or a key prefixed
 * NEXT_PUBLIC_/VITE_ without anyone noticing that the prefix is a publication
 * decision. Once it is in a bundle it is in every visitor's cache, every CDN
 * edge and the Internet Archive — and rotation is the only remedy.
 *
 * Scans inline scripts and the site's own external bundles (see
 * context/fetch-scripts.ts for why third-party scripts are out of scope). Only
 * issuer-defined key shapes are reported, never anything that merely looks
 * random — see secrets/patterns.ts.
 */

import type { Check, Finding } from '../../types.ts'
import { findSecrets, type SecretMatch } from './patterns.ts'

const ID = 'security.secrets.secrets-in-js'

export const secretsInJsCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Secrets in JavaScript',

  run(ctx) {
    const found = new Map<string, SecretMatch & { where: string }>()

    for (const script of ctx.scripts) {
      if (!script.content) continue
      const where = script.url || 'inline script'
      for (const match of findSecrets(script.content)) {
        // The same key appears in several chunks of one build; report it once,
        // attributed to where it was first seen.
        if (!found.has(match.sample)) found.set(match.sample, { ...match, where })
      }
    }

    if (found.size === 0) return []

    const matches = [...found.values()]
    const critical = matches.some((m) => m.severity === 'critical')
    const kinds = [...new Set(matches.map((m) => m.kind))]

    return [
      {
        checkId: ID,
        category: 'security',
        severity: critical ? 'critical' : 'high',
        title: `${matches.length} credential${matches.length === 1 ? '' : 's'} in client-side JavaScript`,
        description:
          `The JavaScript this page serves contains ${kinds.join(', ')}. Anyone can read it with ` +
          'view-source; it is also sitting in every visitor\'s browser cache, on every CDN edge that ' +
          'served the file, and in archive crawls. ' +
          matches.map((m) => `${m.kind}: ${m.impact}`).join('. ') +
          '.',
        evidence: {
          // Redacted samples only — enough to locate the string in the bundle,
          // never enough to use it. This value is stored and rendered publicly.
          secrets: matches.map((m) => ({ kind: m.kind, sample: m.sample, foundIn: m.where })),
        },
        remediation:
          'Rotate every key listed, then move the ones that must stay secret behind a server route — ' +
          'removing them from the bundle does not un-publish what was already downloaded.',
        fixPrompt:
          `This site's client JavaScript contains: ${kinds.join(', ')}.\n\n` +
          'Order matters:\n' +
          '1. ROTATE each key at its issuer first. Every copy already served is compromised and no ' +
          'code change recalls it.\n' +
          '2. Find where each value enters the bundle. The usual cause is a secret read in client ' +
          'code, or one exposed through a public build prefix — NEXT_PUBLIC_, VITE_, REACT_APP_. ' +
          'Those prefixes mean "publish this", so a secret behind one is a naming mistake with a ' +
          'security outcome.\n' +
          '3. Move each call that needs the key to a server route, an API route or a server action, ' +
          'and read the value there from a non-public environment variable.\n' +
          '4. Grep the built output for the new key before deploying, so the next release cannot ' +
          'reintroduce it silently.\n\n' +
          'Leave genuinely publishable keys alone — a Stripe pk_live_, a Supabase anon key and any ' +
          'NEXT_PUBLIC_ value are meant to be in the bundle.',
      } satisfies Finding,
    ]
  },
}
