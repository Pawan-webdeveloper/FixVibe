/**
 * Test helper: build a complete, synthetic CheckContext with zero network I/O.
 *
 * Every unit test describes a site as plain data (headers, html, tls, …) and
 * gets back the same shape buildContext() produces. Defaults describe a plain
 * HTTPS page with no special headers — header checks will naturally flag it,
 * so tests assert on the one check under test, never on "no findings at all".
 */

import * as cheerio from 'cheerio'
import type { CheckContext, ParsedCookie } from '../src/types.ts'
import { parseSetCookies } from '../src/context/cookies.ts'
import { organizationalDomain } from '../src/context/public-suffix.ts'
import { parseRobots } from '../src/context/robots.ts'

export interface ContextOverrides {
  url?: string
  finalUrl?: string
  redirectChain?: string[]
  status?: number
  headers?: Record<string, string>
  html?: string
  cookies?: ParsedCookie[]
  tls?: CheckContext['tls']
  /** Partial: unspecified record types default to empty, as an unconfigured zone. */
  dns?: Partial<CheckContext['dns']>
  robots?: CheckContext['robots']
  httpProbe?: CheckContext['httpProbe']
  probe?: CheckContext['probe']
  scripts?: CheckContext['scripts']
  /**
   * Supplying this is what marks a context as "authorised to test actively".
   * Leave it out and the backend checks are structurally unable to run, which
   * is the behaviour most of their tests assert.
   */
  activeProbe?: CheckContext['activeProbe']
  /**
   * Supplying this is what marks a context as coming from a `deep` scan.
   * Leave it out and the crawl-powered checks stay silent, which is the
   * behaviour their tests assert first.
   */
  crawl?: CheckContext['crawl']
}

const DEFAULT_HTML = '<!doctype html><html lang="en"><head><title>Test</title></head><body><h1>Test</h1></body></html>'

export function makeContext(overrides: ContextOverrides = {}): CheckContext {
  const url = new URL(overrides.url ?? 'https://site.test/')
  const finalUrl = new URL(overrides.finalUrl ?? url.href)
  const html = overrides.html ?? DEFAULT_HTML
  const headers = new Headers(overrides.headers ?? { 'content-type': 'text/html; charset=utf-8' })

  return {
    url,
    finalUrl,
    redirectChain: overrides.redirectChain ?? [],
    status: overrides.status ?? 200,
    headers,
    html,
    $: cheerio.load(html),
    scripts: overrides.scripts ?? [],
    // Derived from Set-Cookie through the real parser, exactly as buildContext
    // does, so a fixture describing a response gets the cookies that response
    // would actually produce.
    cookies: overrides.cookies ?? parseSetCookies(headers),
    tls: overrides.tls ?? null,
    dns: {
      txt: [],
      caa: null,
      mx: [],
      dkim: { selectors: {}, wildcard: null },
      registration: null,
      // Derived, not hardcoded: a test that overrides the URL gets the mail
      // domain its checks would really have been handed.
      emailDomain: organizationalDomain(url.hostname),
      spfTxt: [],
      dmarcTxt: [],
      ...overrides.dns,
    },
    robots: overrides.robots ?? null,
    httpProbe: overrides.httpProbe,
    // Unit tests are network-free by design; a check that probes in a test
    // gets "unreachable" unless the test provides its own stub.
    probe: overrides.probe ?? (() => Promise.resolve(null)),
    // Conditional on purpose, mirroring buildContext: an unauthorised context
    // does not carry a disabled capability, it carries no capability.
    ...(overrides.activeProbe ? { activeProbe: overrides.activeProbe } : {}),
    ...(overrides.crawl ? { crawl: overrides.crawl } : {}),
  }
}

/**
 * A CrawlSummary with sane defaults, so a test naming three link statuses does
 * not have to restate the coverage counters it does not care about.
 */
export function crawlSummary(overrides: Partial<NonNullable<CheckContext['crawl']>> = {}) {
  const linkStatus = overrides.linkStatus ?? {}
  return {
    pages: [],
    linkStatus,
    linksFound: Object.keys(linkStatus).length,
    linksSkipped: 0,
    linksDisallowed: 0,
    ...overrides,
  }
}

/** A sub-page for crawlSummary({ pages: [...] }), with url === finalUrl by default. */
export function crawledPage(path: string, html: string, origin = 'https://site.test') {
  const url = new URL(path, origin).href
  return { url, finalUrl: url, status: 200, html }
}

/** Minimal document with a title and (optionally) a meta description. */
export function pageHtml(title: string, description?: string): string {
  return (
    '<!doctype html><html lang="en"><head>' +
    `<title>${title}</title>` +
    (description === undefined ? '' : `<meta name="description" content="${description}" />`) +
    '</head><body><h1>x</h1></body></html>'
  )
}

/**
 * activeProbe() stub over a url → response map. An unlisted url resolves to
 * null, i.e. unreachable — the same thing the real capability does when a
 * request fails or the budget runs out.
 */
export function activeProbeStub(
  responses: Record<string, { status: number; body?: string; headers?: Record<string, string> }>,
): NonNullable<CheckContext['activeProbe']> {
  return (url) => {
    const response = responses[url]
    if (!response) return Promise.resolve(null)
    return Promise.resolve({
      status: response.status,
      body: response.body ?? '',
      headers: new Headers(response.headers ?? {}),
    })
  }
}

/** TLS summary expiring `days` from now — keeps fixtures free of hardcoded dates. */
export function tlsExpiringIn(days: number, protocol = 'TLSv1.3', issuer = 'Test CA'): CheckContext['tls'] {
  return { validTo: new Date(Date.now() + days * 86_400_000), protocol, issuer }
}

/**
 * A page that satisfies every SEO check. The point of a "clean" fixture is to
 * prove the registry stays SILENT on a well-built site — false positives are
 * what make a scanner unusable, so this HTML is the guard against them.
 */
export const CLEAN_SEO_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ScanlyFix — Website Scanner Test Fixture Page</title>
    <meta name="description" content="A synthetic fixture page used by the ScanlyFix engine tests to represent a site with no SEO problems at all." />
    <link rel="canonical" href="https://site.test/" />
    <meta property="og:title" content="ScanlyFix — Website Scanner Test Fixture" />
    <meta property="og:description" content="A synthetic fixture page with complete social metadata." />
    <meta property="og:image" content="https://site.test/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", "name": "ScanlyFix", "url": "https://site.test/" },
          {
            "@type": "Organization",
            "name": "ScanlyFix",
            "url": "https://site.test/",
            "sameAs": ["https://github.com/scanlyfix", "https://www.linkedin.com/company/scanlyfix"]
          }
        ]
      }
    </script>
  </head>
  <body>
    <h1>ScanlyFix scanner fixture</h1>
  </body>
</html>`

/**
 * An llms.txt a well-configured site would serve. Markdown, not HTML — the
 * check treats an app shell at this path as a finding of its own.
 */
export const LLMS_TXT = [
  '# ScanlyFix',
  '',
  '> A synthetic fixture site used by the engine tests.',
  '',
  '## Docs',
  '- [Checks](https://site.test/checks): what the scanner looks for',
  '',
].join('\n')

/** Minimal valid sitemap body for a probe stub. */
export const SITEMAP_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://site.test/</loc></url></urlset>'

/**
 * robots.txt built through the REAL parser, so a test asserting "this site is
 * crawlable" fails if the parser regresses — a hand-rolled stub would not.
 */
export function robotsFrom(raw: string): CheckContext['robots'] {
  return parseRobots(raw)
}

/** Allows everything and declares a sitemap — the shape a healthy site serves. */
export function permissiveRobots(sitemapUrl = 'https://site.test/sitemap.xml'): CheckContext['robots'] {
  return parseRobots(`User-agent: *\nAllow: /\nSitemap: ${sitemapUrl}\n`)
}

/**
 * A well-configured mail zone. Real-shaped rather than minimal: `~all` with
 * several includes is what competent domains actually publish, so a check that
 * fires on this is miscalibrated, not observant.
 */
export const HEALTHY_DNS: Partial<CheckContext['dns']> = {
  emailDomain: 'site.test',
  mx: ['aspmx.l.google.com'],
  spfTxt: ['v=spf1 include:_spf.google.com include:sendgrid.net ~all'],
  dmarcTxt: ['v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@site.test'],
  // A real (short) RSA key, not a placeholder: the DKIM check distinguishes a
  // published key from a revoked one by whether p= has a value.
  dkim: {
    selectors: {
      google: ['v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC4T1PE2vh5xqRGzOrDnkoi'],
    },
    wildcard: null,
  },
  caa: {
    name: 'site.test',
    records: ['issue "letsencrypt.org"', 'issuewild "letsencrypt.org"', 'iodef "mailto:security@site.test"'],
  },
}

/**
 * An RFC 9116 security.txt whose Expires is `daysValid` from now — computed so
 * the fixture cannot rot into an "expired" finding a year after it was written.
 */
export function securityTxt(daysValid = 365): string {
  const expires = new Date(Date.now() + daysValid * 86_400_000).toISOString()
  return [`Contact: mailto:security@site.test`, `Expires: ${expires}`, 'Preferred-Languages: en', ''].join('\n')
}

/** probe() stub over a path → response map; unlisted paths resolve to null (unreachable). */
export function probeStub(
  responses: Record<string, { status: number; body?: string; headers?: Record<string, string> }>,
): CheckContext['probe'] {
  return (path) => {
    const response = responses[path]
    if (!response) return Promise.resolve(null)
    return Promise.resolve({
      status: response.status,
      body: response.body ?? '',
      headers: new Headers(response.headers ?? {}),
    })
  }
}
