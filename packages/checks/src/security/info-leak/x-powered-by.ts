/**
 * X-Powered-By and the framework banners that do exactly the same job — headers
 * whose entire content is "this site runs <software>, version <n>".
 *
 * Scope is X-Powered-By, X-AspNet-Version, X-AspNetMvc-Version and X-Generator.
 * All four share one property: nothing reads them. No browser behaviour, no
 * proxy, no spec depends on them, so deleting them is free and cannot break a
 * client. That property — not "mentions a framework" — is the boundary here.
 *
 * Deliberately out of scope:
 *  - Server, which RFC 9110 defines, which some proxies and CDNs will not let
 *    you drop, and which security.info-leak.server-header already owns. The
 *    same disclosure reported by two checks would charge the score twice.
 *  - X-Drupal-Cache and its cousins, which carry operational data (HIT/MISS)
 *    rather than a version, are read by the people debugging the cache, and so
 *    fail the "removing it is free" test the remediation below rests on. Naming
 *    the CMS is not enough to belong here.
 *
 * Every banner present is collapsed into ONE finding: they come from a single
 * stack and are removed by a single config change, so one mistake should cost
 * the score once.
 */

import type { Check, Finding, Severity } from '../../types.ts'

const ID = 'security.info-leak.x-powered-by'

/** Canonical casing for display only — Headers.get() matches case-insensitively. */
const BANNER_HEADERS = [
  'X-Powered-By',
  'X-AspNet-Version',
  'X-AspNetMvc-Version',
  'X-Generator',
] as const

interface Banner {
  name: string
  value: string
}

/**
 * A version token opens the value or follows a separator: "PHP/8.2.4",
 * "ASP.NET 4.0", "4.0.30319", "Drupal 10". Digits welded into a product name
 * ("W3 Total Cache", "HHVM") sit behind a letter and do not match — that is
 * what keeps the low/info split below honest rather than decorative.
 */
const VERSION_RE = /(?:^|[/\s(])v?\d+(?:\.\d+)*\b/

/**
 * The fix is one documented flag in the stack's own config, and the header
 * value says which stack. Matched against "name: value" pairs so that
 * X-AspNet-Version — whose value is a bare number — is still recognised by its
 * name. First match wins; the caller falls back to stripping at the edge.
 */
const REMOVALS: ReadonlyArray<{ match: RegExp; snippet: string }> = [
  {
    match: /asp\.?net/i,
    snippet:
      'On ASP.NET, add <httpRuntime enableVersionHeader="false" /> under <system.web> and ' +
      '<remove name="X-Powered-By" /> under <system.webServer><httpProtocol><customHeaders> in web.config.',
  },
  {
    match: /next\.?js/i,
    snippet: 'On Next.js, set poweredByHeader: false in next.config.js.',
  },
  {
    match: /express/i,
    snippet: "On Express, call app.disable('x-powered-by') on the app instance (Helmet also does this).",
  },
  {
    match: /\bphp\b|hhvm/i,
    snippet: 'On PHP, set expose_php = Off in php.ini and reload PHP-FPM.',
  },
  {
    match: /drupal/i,
    snippet:
      'On Drupal, remove the generator header with a response event subscriber, or unset it at the ' +
      'web server (Apache: Header always unset X-Generator).',
  },
]

function removalSnippet(banners: readonly Banner[]): string {
  const known = REMOVALS.find((r) => r.match.test(banners.map((b) => `${b.name}: ${b.value}`).join(' ')))
  if (known) return known.snippet

  // Unrecognised stack: the edge is the one place we know can drop the header.
  const first = banners[0]?.name ?? 'X-Powered-By'
  const names = banners.map((b) => b.name).join(', ')
  return (
    `Unset ${names} where responses leave the origin or CDN (Apache: Header always unset ${first}; ` +
    `nginx with headers-more: more_clear_headers ${first};)` +
    (banners.length > 1 ? ', repeating the directive once per header.' : '.')
  )
}

export const xPoweredByCheck: Check = {
  id: ID,
  category: 'security',
  title: 'X-Powered-By disclosure',

  run(ctx) {
    const banners: Banner[] = BANNER_HEADERS.flatMap((name) => {
      const value = ctx.headers.get(name)?.trim()
      return value ? [{ name, value }] : []
    })

    if (banners.length === 0) return []

    const discloseVersion = banners.some((b) => VERSION_RE.test(b.value))
    const label = banners.map((b) => b.name).join(', ')
    const pairs = banners.map((b) => `${b.name}: ${b.value}`).join(', ')
    const many = banners.length > 1

    // Nothing here is exploitable on its own, so this stays hygiene-grade. The
    // version string is the only part with real leverage — it matches the
    // deployment to published advisories for that exact release without a
    // single probe — and earns 'low'. A bare technology name is something
    // response behaviour gives away anyway, so it is stated at 'info': visible
    // to the owner, costing the score nothing for a consequence we cannot show.
    const severity: Severity = discloseVersion ? 'low' : 'info'

    return [
      {
        checkId: ID,
        category: 'security',
        severity,
        title: discloseVersion
          ? `${label} ${many ? 'disclose' : 'discloses'} the stack and its version`
          : `${label} ${many ? 'name' : 'names'} the stack`,
        description: discloseVersion
          ? `${label} ${many ? 'name' : 'names'} the software serving this site and the exact release ` +
            'it runs. The version is the part that matters: it lets anyone line the deployment up ' +
            'against published advisories for that release without probing for it first. Nothing reads ' +
            'these values back — not a browser, a proxy, or a spec — so the disclosure buys nothing.'
          : `${label} ${many ? 'name' : 'names'} the software serving this site, without a version. ` +
            'That narrows little beyond what response behaviour already reveals, so this is an ' +
            'observation rather than an exposure — and since no browser, proxy or spec reads these ' +
            'values, it is disclosure at zero benefit.',
        evidence: Object.fromEntries(banners.map((b) => [b.name, b.value])),
        remediation:
          `${many ? 'These headers have' : 'This header has'} no protocol purpose, so removing ` +
          `${many ? 'them is' : 'it is'} free and cannot break any client. ${removalSnippet(banners)}`,
        fixPrompt: [
          `This site sends ${pairs}.`,
          removalSnippet(banners),
          ...(many ? ['Remove every header listed, not just the first.'] : []),
          `Then redeploy and confirm with "curl -sI ${ctx.finalUrl.origin}" that ` +
            `${many ? 'none of them come' : 'it does not come'} back.`,
        ].join(' '),
      } satisfies Finding,
    ]
  },
}
