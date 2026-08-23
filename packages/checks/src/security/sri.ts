/**
 * Subresource Integrity on third-party scripts and stylesheets.
 *
 * A script loaded from someone else's host runs with the full privileges of
 * this page. Without an `integrity` hash the browser executes whatever that
 * host returns today, which makes the site's security a function of the CDN's
 * — the shape of every supply-chain incident where a widely-used script was
 * altered at source and every site including it shipped the change.
 *
 * Deliberately scoped to CROSS-ORIGIN subresources. SRI on a same-origin file
 * protects against an attacker who already controls the origin, which is a
 * threat model where the hash is the least of the problems — and demanding it
 * would fire on nearly every site while suggesting a build step that breaks on
 * the next deploy.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'security.sri'

interface Unprotected {
  kind: 'script' | 'stylesheet'
  url: string
}

export const sriCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Subresource Integrity',

  run(ctx) {
    const unprotected: Unprotected[] = []

    const consider = (kind: Unprotected['kind'], rawUrl: string | undefined, integrity: string | undefined) => {
      if (!rawUrl) return
      let url: URL
      try {
        url = new URL(rawUrl, ctx.finalUrl)
      } catch {
        return
      }
      if (url.origin === ctx.finalUrl.origin) return
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return
      if ((integrity ?? '').trim()) return
      unprotected.push({ kind, url: url.href })
    }

    for (const el of ctx.$('script[src]').toArray()) {
      consider('script', ctx.$(el).attr('src'), ctx.$(el).attr('integrity'))
    }

    for (const el of ctx.$('link[href]').toArray()) {
      // rel is a case-insensitive token set: "Stylesheet" and
      // "alternate stylesheet" are both stylesheets.
      const rel = (ctx.$(el).attr('rel') ?? '').toLowerCase().split(/\s+/)
      if (!rel.includes('stylesheet')) continue
      consider('stylesheet', ctx.$(el).attr('href'), ctx.$(el).attr('integrity'))
    }

    if (unprotected.length === 0) return []

    /**
     * Grouped by HOST, because that is the unit of both the risk and the fix.
     * A site loading eighty files from one CDN it controls is one decision, not
     * eighty problems, and a per-file count reads as an emergency when it is
     * usually a configuration preference.
     */
    const byHost = new Map<string, string[]>()
    for (const item of unprotected) {
      const host = new URL(item.url).hostname
      byHost.set(host, [...(byHost.get(host) ?? []), item.url])
    }
    const hosts = [...byHost.keys()]

    return [
      {
        checkId: ID,
        category: 'security',
        severity: 'low',
        title: `Loads code from ${hosts.length} other origin${hosts.length === 1 ? '' : 's'} without integrity hashes`,
        description:
          `This page loads scripts or styles from ${hosts.join(', ')} with no integrity attribute, so ` +
          'the browser runs whatever those hosts return at the moment of the request — and a script ' +
          'has the same access to the page as the site\'s own code. How much that matters depends on ' +
          'who runs the host: a CDN under the same ownership is a far weaker case than a genuine ' +
          'third party, and this check cannot tell the two apart from the outside.',
        evidence: {
          hosts: hosts.map((host) => ({ host, files: byHost.get(host)?.length ?? 0 })),
          sample: unprotected.slice(0, 6),
        },
        remediation:
          'Add integrity and crossorigin attributes to versioned URLs from hosts you do not control, ' +
          'or self-host those files.',
        fixPrompt:
          `This page loads third-party subresources without SRI: ${unprotected.slice(0, 6).map((u) => u.url).join(', ')}.\n\n` +
          'For each one, either:\n' +
          '- Add integrity="sha384-..." and crossorigin="anonymous". Generate the hash with ' +
          '`curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`. This only works on a ' +
          'VERSIONED url — pinning a hash to a "latest" URL breaks the page the day the file changes, ' +
          'which is the point but is also an outage.\n' +
          '- Or self-host the file through the build, which removes the third party from the trust ' +
          'chain entirely and is usually the better answer for anything small.',
      } satisfies Finding,
    ]
  },
}
