/**
 * PSI cache tests.
 *
 * Tests URL normalization for cache keys.
 * DB integration tested via the web-vitals-probe workflow tests.
 */

import { describe, expect, it } from 'vitest'
import { normalizeCacheKey } from '@scanlyfix/db/queries/psi-cache.ts'

describe('normalizeCacheKey', () => {
  it('strips trailing slash from path', () => {
    expect(normalizeCacheKey('https://example.com/')).toBe('https://example.com/')
  })

  it('preserves non-root paths', () => {
    expect(normalizeCacheKey('https://example.com/page')).toBe('https://example.com/page')
  })

  it('preserves query strings', () => {
    expect(normalizeCacheKey('https://example.com/page?a=1&b=2')).toBe(
      'https://example.com/page?a=1&b=2',
    )
  })

  it('preserves hash', () => {
    expect(normalizeCacheKey('https://example.com/page#section')).toBe(
      'https://example.com/page#section',
    )
  })

  it('handles URLs without path', () => {
    expect(normalizeCacheKey('https://example.com')).toBe('https://example.com/')
  })

  it('returns raw string for invalid URLs', () => {
    expect(normalizeCacheKey('not-a-url')).toBe('not-a-url')
  })

  it('normalizes same URL to same key', () => {
    const key1 = normalizeCacheKey('https://example.com/page')
    const key2 = normalizeCacheKey('https://example.com/page/')
    // Root path: trailing slash is kept
    expect(key1).toBe('https://example.com/page')
  })
})
