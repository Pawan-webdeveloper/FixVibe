/**
 * Server header — the banner the origin volunteers on every response. A bare
 * product name ("nginx", "cloudflare", "gws") tells an attacker nothing they
 * could not learn from a TCP fingerprint, so it is deliberately silent here.
 * A version token ("Apache/2.2.15 (CentOS)") is different: it turns target
 * selection into a single lookup against a published advisory list.
 *
 * What this check deliberately does NOT do: resolve the version against a CVE
 * feed. We cannot tell here whether 1.18.0 is current or three years stale, so
 * the finding claims only what the header actually says and stays at one low
 * severity either way — this is reconnaissance convenience, not a vulnerability.
 * X-Powered-By belongs to the sibling check, and an absent Server header
 * discloses nothing, so both leave here empty-handed.
 */

import type { Check, Finding } from '../../types.ts'

const ID = 'security.info-leak.server'

/**
 * Product/version pairs: "nginx/1.18.0", "Apache 2.4.41", "Jetty(9.4.z-SNAPSHOT)".
 * At least two dot-separated numeric parts are required, which is what keeps
 * bare vendor names and opaque node ids ("ECS (dcb/7F83)") from matching.
 */
const VERSIONED_COMPONENT = /([A-Za-z][A-Za-z0-9._+-]*)[/ (]v?(\d+(?:\.\d+)+[A-Za-z0-9.+_-]*)/g

/** Parenthetical build detail — "(Ubuntu)", "(Red Hat Enterprise Linux)", "(Unix)". */
const PARENTHETICAL = /\(([^)]+)\)/g

/**
 * A platform hint reads as words. Requiring a leading letter and no punctuation
 * beyond spaces/dots/dashes keeps two impostors out: parenthesised versions
 * ("Jetty(9.4.z-SNAPSHOT)") and opaque CDN node ids ("(dcb/7F83)"), neither of
 * which we could honestly call a platform.
 */
const PLATFORM_SHAPED = /^[A-Za-z][A-Za-z0-9 ._-]*$/

/**
 * Products whose Server version is a fixed product generation shipped by every
 * instance on the platform, not a patch level — the same string appears in front
 * of fully-patched and unpatched fleets alike, so it supports no advisory lookup.
 */
const CONSTANT_BANNERS = new Set(['awselb', 'microsoft-httpapi'])

interface Component {
  product: string
  version: string
}

function parseComponents(header: string): Component[] {
  const components: Component[] = []
  for (const match of header.matchAll(VERSIONED_COMPONENT)) {
    const [, product, version] = match
    if (product && version && !CONSTANT_BANNERS.has(product.toLowerCase())) {
      components.push({ product, version })
    }
  }
  return components
}

export const serverHeaderCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Server header disclosure',

  run(ctx) {
    const header = ctx.headers.get('server')?.trim()
    if (!header) return []

    const components = parseComponents(header)
    const primary = components[0]
    if (!primary) return []

    const platforms = [...header.matchAll(PARENTHETICAL)]
      .map((match) => match[1]?.trim())
      .filter((p): p is string => p !== undefined && PLATFORM_SHAPED.test(p))

    const named = components.map((c) => `${c.product} ${c.version}`).join(', ')

    return [
      {
        checkId: ID,
        category: 'security',
        severity: 'low',
        title: `Server header discloses ${primary.product} ${primary.version}`,
        description:
          `The Server header names the exact build answering requests (${named}). This is not a ` +
          'vulnerability on its own — it is reconnaissance: it turns "which published advisories apply ' +
          'to this host" into one lookup, and it keeps answering that question for as long as the ' +
          'build goes unpatched.' +
          (platforms.length > 0
            ? ` The header also names a platform in parentheses (${platforms.join(', ')}), which ` +
              'narrows the fingerprint from a product version to a particular packaged build.'
            : ''),
        evidence: {
          header,
          components,
          ...(platforms.length > 0 ? { platforms } : {}),
        },
        remediation:
          'Suppress the version in the banner: nginx "server_tokens off;", Apache "ServerTokens Prod", ' +
          'IIS removes it via URL Rewrite or a removeServerHeader rule.',
        fixPrompt:
          `This site answers with "Server: ${header}", disclosing its exact version. Configure the web ` +
          'server to emit a bare product name or no Server header at all — nginx: server_tokens off; ' +
          'Apache: ServerTokens Prod plus ServerSignature Off; IIS: remove the header in web.config. ' +
          'If a CDN or reverse proxy fronts the origin, strip or overwrite it there too, since that hop ' +
          'is the one users see. Keep patching on its own schedule — hiding the banner is not a fix for ' +
          'an outdated build.',
      } satisfies Finding,
    ]
  },
}
