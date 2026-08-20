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

export interface ContextOverrides {
  url?: string
  finalUrl?: string
  redirectChain?: string[]
  status?: number
  headers?: Record<string, string>
  html?: string
  cookies?: ParsedCookie[]
  tls?: CheckContext['tls']
  dns?: CheckContext['dns']
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
    dns: overrides.dns ?? { txt: [], caa: [], mx: [], dnssec: false },
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
