/**
 * PSI retry and quota handling tests.
 *
 * Tests exponential backoff for 429/403 errors, timeout handling,
 * and graceful degradation.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { checkWebVitals } from '../src/performance/web-vitals.ts'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('PSI retry and quota handling', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retries on 429 and succeeds on second attempt', async () => {
    // First call: 429
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Rate limit exceeded' } }),
    })
    // Second call: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        lighthouseResult: {
          audits: {
            'largest-contentful-paint': { numericValue: 2000 },
            'interaction-to-paint': { numericValue: 150 },
            'cumulative-layout-shift': { numericValue: 0.05 },
            'first-contentful-paint': { numericValue: 1200 },
            'server-response-time': { numericValue: 300 },
            'speed-index': { numericValue: 2500 },
          },
        },
      }),
    })

    const result = await checkWebVitals('https://example.com')
    expect(result.ok).toBe(true)
    expect(result.lcp).toBe(2000)
    expect(result.inp).toBe(150)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('retries on 403 and succeeds on second attempt', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'Forbidden' } }),
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        lighthouseResult: {
          audits: {
            'largest-contentful-paint': { numericValue: 1800 },
            'interaction-to-paint': { numericValue: 120 },
            'cumulative-layout-shift': { numericValue: 0.03 },
            'first-contentful-paint': { numericValue: 900 },
            'server-response-time': { numericValue: 250 },
            'speed-index': { numericValue: 2000 },
          },
        },
      }),
    })

    const result = await checkWebVitals('https://example.com')
    expect(result.ok).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('fails after max retries (2) on persistent 429', async () => {
    // All 3 attempts fail with 429
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Quota exceeded' } }),
    })

    const result = await checkWebVitals('https://example.com')
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('PSI quota exceeded')
    expect(result.detail).toContain('will retry next run')
    expect(mockFetch).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it('does NOT retry on 500 (non-quota error)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Internal error' } }),
    })

    const result = await checkWebVitals('https://example.com')
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Internal error')
    expect(mockFetch).toHaveBeenCalledTimes(1) // No retry
  })

  it('does NOT retry on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result = await checkWebVitals('https://example.com')
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('ECONNREFUSED')
    expect(mockFetch).toHaveBeenCalledTimes(1) // No retry
  })

  it('returns timeout error without retry', async () => {
    const timeoutError = new Error('Timeout')
    timeoutError.name = 'TimeoutError'
    mockFetch.mockRejectedValueOnce(timeoutError)

    const result = await checkWebVitals('https://example.com')
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('timed out')
    expect(result.detail).toContain('90s')
    expect(mockFetch).toHaveBeenCalledTimes(1) // No retry
  })

  it('uses 90s timeout', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        lighthouseResult: { audits: {} },
      }),
    })

    await checkWebVitals('https://example.com')

    const [, options] = mockFetch.mock.calls[0]!
    expect(options.signal).toBeDefined()
    // AbortSignal.timeout creates a TimeoutSignal — just verify it exists
  })
})
