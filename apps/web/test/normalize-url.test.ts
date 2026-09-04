/**
 * URL normalization tests.
 *
 * Verifies that:
 *   - normalizeUrl handles all edge cases
 *   - stripWww removes www. prefix correctly
 *   - urlsMatch compares URLs with normalization
 *   - All 6 URL variants match
 */

import { describe, expect, it } from 'vitest'
import { normalizeUrl, stripWww, urlsMatch } from '../lib/normalize-url.ts'

describe('normalizeUrl', () => {
  it('lowercases protocol and host', () => {
    expect(normalizeUrl('HTTPS://EXAMPLE.COM')).toBe('https://example.com')
    expect(normalizeUrl('HTTP://Example.Com')).toBe('http://example.com')
  })

  it('strips trailing slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com')
    expect(normalizeUrl('https://example.com/path/')).toBe('https://example.com/path')
  })

  it('preserves root path trailing slash', () => {
    // Root path "/" should not be stripped to empty string
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com')
  })

  it('strips default https port (:443)', () => {
    expect(normalizeUrl('https://example.com:443')).toBe('https://example.com')
    expect(normalizeUrl('https://example.com:443/')).toBe('https://example.com')
  })

  it('strips default http port (:80)', () => {
    expect(normalizeUrl('http://example.com:80')).toBe('http://example.com')
    expect(normalizeUrl('http://example.com:80/')).toBe('http://example.com')
  })

  it('preserves non-default ports', () => {
    expect(normalizeUrl('https://example.com:3000')).toBe('https://example.com:3000')
    expect(normalizeUrl('http://example.com:8080')).toBe('http://example.com:8080')
  })

  it('preserves path', () => {
    expect(normalizeUrl('https://example.com/path/to/page')).toBe('https://example.com/path/to/page')
    expect(normalizeUrl('https://example.com/path/to/page/')).toBe('https://example.com/path/to/page')
  })

  it('preserves query string', () => {
    // URL parser adds / before ? when path is empty
    expect(normalizeUrl('https://example.com?foo=bar')).toBe('https://example.com/?foo=bar')
    expect(normalizeUrl('https://example.com/?foo=bar')).toBe('https://example.com/?foo=bar')
  })

  it('preserves fragment', () => {
    // Note: URL parser adds trailing slash for root path with fragment
    expect(normalizeUrl('https://example.com#section')).toBe('https://example.com/#section')
    expect(normalizeUrl('https://example.com/path#section')).toBe('https://example.com/path#section')
  })

  it('returns null for invalid URLs', () => {
    expect(normalizeUrl('not-a-url')).toBeNull()
    expect(normalizeUrl('')).toBeNull()
    expect(normalizeUrl('ftp://example.com')).not.toBeNull() // valid URL, just ftp
  })
})

describe('stripWww', () => {
  it('removes www. prefix', () => {
    expect(stripWww('https://www.example.com')).toBe('https://example.com')
    expect(stripWww('https://www.example.com/')).toBe('https://example.com')
  })

  it('does nothing if no www. prefix', () => {
    expect(stripWww('https://example.com')).toBe('https://example.com')
    expect(stripWww('https://example.com/www')).toBe('https://example.com/www')
  })

  it('handles www. in middle of hostname', () => {
    // www. only at start of hostname
    expect(stripWww('https://notwww.example.com')).toBe('https://notwww.example.com')
  })

  it('returns null for invalid URLs', () => {
    expect(stripWww('not-a-url')).toBeNull()
  })
})

describe('urlsMatch', () => {
  it('matches identical URLs', () => {
    expect(urlsMatch('https://example.com', 'https://example.com')).toBe(true)
  })

  it('matches with trailing slash difference', () => {
    expect(urlsMatch('https://example.com', 'https://example.com/')).toBe(true)
    expect(urlsMatch('https://example.com/', 'https://example.com')).toBe(true)
  })

  it('matches with case difference', () => {
    expect(urlsMatch('https://EXAMPLE.COM', 'https://example.com')).toBe(true)
    expect(urlsMatch('https://Example.Com', 'https://example.com')).toBe(true)
  })

  it('matches with www. difference', () => {
    expect(urlsMatch('https://www.example.com', 'https://example.com')).toBe(true)
    expect(urlsMatch('https://example.com', 'https://www.example.com')).toBe(true)
  })

  it('matches with default port difference', () => {
    expect(urlsMatch('https://example.com:443', 'https://example.com')).toBe(true)
    expect(urlsMatch('http://example.com:80', 'http://example.com')).toBe(true)
  })

  it('matches with all variations combined', () => {
    expect(urlsMatch('HTTPS://WWW.EXAMPLE.COM:443/', 'https://example.com')).toBe(true)
    expect(urlsMatch('http://www.example.com:80/path/', 'http://example.com/path')).toBe(true)
  })

  it('does not match different hosts', () => {
    expect(urlsMatch('https://example.com', 'https://other.com')).toBe(false)
  })

  it('does not match different paths', () => {
    expect(urlsMatch('https://example.com/a', 'https://example.com/b')).toBe(false)
  })

  it('does not match different protocols', () => {
    expect(urlsMatch('https://example.com', 'http://example.com')).toBe(false)
  })

  it('does not match non-default ports', () => {
    expect(urlsMatch('https://example.com:3000', 'https://example.com')).toBe(false)
  })

  it('returns false for invalid URLs', () => {
    expect(urlsMatch('not-a-url', 'https://example.com')).toBe(false)
    expect(urlsMatch('https://example.com', 'not-a-url')).toBe(false)
  })
})

describe('6 URL variants match (acceptance criteria)', () => {
  const variants = [
    'https://example.com',
    'https://example.com/',
    'https://Example.com',
    'https://EXAMPLE.COM',
    'https://www.example.com',
    'https://www.example.com/',
  ]

  it('all 6 variants match each other', () => {
    for (let i = 0; i < variants.length; i++) {
      for (let j = 0; j < variants.length; j++) {
        expect(urlsMatch(variants[i]!, variants[j]!)).toBe(true)
      }
    }
  })
})
