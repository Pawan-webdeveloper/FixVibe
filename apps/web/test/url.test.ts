/**
 * The normalizer is the first thing a stranger's input touches, so most of
 * these cases are about failing in a sentence rather than a stack trace — and
 * about the two parses that are easy to get subtly wrong: a bare host with a
 * port, and a protocol-relative address.
 */

import { describe, expect, it } from 'vitest'
import { normalizeScanTarget } from '../lib/url.ts'

const ok = (input: string) => {
  const result = normalizeScanTarget(input)
  if (!result.ok) throw new Error(`expected "${input}" to parse, got: ${result.reason}`)
  return result
}

const rejected = (input: string) => {
  const result = normalizeScanTarget(input)
  if (result.ok) throw new Error(`expected "${input}" to be rejected, got: ${result.url}`)
  return result
}

describe('normalizeScanTarget', () => {
  it('assumes https for a bare domain, the way people type them', () => {
    expect(ok('example.com').url).toBe('https://example.com/')
  })

  it('keeps an explicit http:// rather than silently upgrading it', () => {
    // The https-redirect check exists to report that; rewriting it here would
    // hide the very finding the user came for.
    expect(ok('http://example.com').url).toBe('http://example.com/')
  })

  it('preserves path, query and port', () => {
    expect(ok('example.com/blog?page=2').url).toBe('https://example.com/blog?page=2')
    expect(ok('example.com:8443/status').url).toBe('https://example.com:8443/status')
  })

  it('does not mistake a bare host:port for a scheme', () => {
    // Without the "//" rule this parses as the scheme "example.com".
    expect(ok('example.com:8080').hostname).toBe('example.com')
  })

  it('lowercases the host and trims surrounding whitespace', () => {
    const result = ok('  WWW.Example.COM  ')
    expect(result.hostname).toBe('www.example.com')
  })

  it('resolves a protocol-relative address instead of producing an empty host', () => {
    expect(ok('//example.com/page').url).toBe('https://example.com/page')
  })

  it('strips a fragment, which never reaches the server anyway', () => {
    expect(ok('example.com/docs#section-3').url).toBe('https://example.com/docs')
  })

  it('strips a trailing root dot', () => {
    expect(ok('example.com.').hostname).toBe('example.com')
  })

  it('accepts a bracketed IPv6 literal — the SSRF guard decides if it is reachable', () => {
    expect(ok('http://[2606:2800:220:1:248:1893:25c8:1946]/').ok).toBe(true)
  })

  it('asks for input rather than failing on an empty box', () => {
    expect(rejected('').reason).toContain('Enter a website address')
    expect(rejected('   ').reason).toContain('Enter a website address')
  })

  it('refuses a non-web scheme', () => {
    expect(rejected('ftp://example.com').reason).toContain('http://')
    expect(rejected('file:///etc/passwd').reason).toContain('http://')
  })

  it('refuses javascript: rather than letting it through as a hostname', () => {
    expect(rejected('javascript:alert(1)').ok).toBe(false)
  })

  it('refuses credentials embedded in the address', () => {
    expect(rejected('https://user:pass@example.com').reason).toContain('username and password')
  })

  it('refuses a single-label host with a suggestion', () => {
    expect(rejected('localhost').reason).toContain('example.com')
    expect(rejected('intranet').reason).toContain('example.com')
  })

  it('refuses an absurdly long input', () => {
    expect(rejected(`example.com/${'a'.repeat(3000)}`).reason).toContain('too long')
  })
})
