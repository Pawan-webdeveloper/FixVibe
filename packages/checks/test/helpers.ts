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
}

const DEFAULT_HTML = '<!doctype html><html lang="en"><head><title>Test</title></head><body><h1>Test</h1></body></html>'

export function makeContext(overrides: ContextOverrides = {}): CheckContext {
  const url = new URL(overrides.url ?? 'https://site.test/')
  const finalUrl = new URL(overrides.finalUrl ?? url.href)
  const html = overrides.html ?? DEFAULT_HTML

  return {
    url,
    finalUrl,
    redirectChain: overrides.redirectChain ?? [],
    status: overrides.status ?? 200,
    headers: new Headers(overrides.headers ?? { 'content-type': 'text/html; charset=utf-8' }),
    html,
    $: cheerio.load(html),
    scripts: [],
    cookies: overrides.cookies ?? [],
    tls: overrides.tls ?? null,
    dns: {
      txt: [],
      caa: [],
      mx: [],
      dnssec: false,
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
    <title>Darvin — Website Scanner Test Fixture Page</title>
    <meta name="description" content="A synthetic fixture page used by the Darvin engine tests to represent a site with no SEO problems at all." />
    <link rel="canonical" href="https://site.test/" />
    <meta property="og:title" content="Darvin — Website Scanner Test Fixture" />
    <meta property="og:description" content="A synthetic fixture page with complete social metadata." />
    <meta property="og:image" content="https://site.test/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">
      { "@context": "https://schema.org", "@type": "WebSite", "name": "Darvin", "url": "https://site.test/" }
    </script>
  </head>
  <body>
    <h1>Darvin scanner fixture</h1>
  </body>
</html>`

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
