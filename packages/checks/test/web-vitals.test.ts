/**
 * Web Vitals checker tests.
 *
 * Tests the PSI API integration and URL validation.
 * Network calls are mocked to avoid external dependencies.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { checkWebVitals, WebVitalsResultSchema } from '../src/performance/web-vitals.ts'

// Mock fetch to avoid real API calls
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('checkWebVitals', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects localhost URLs (SSRF prevention)', async () => {
    const result = await checkWebVitals('http://localhost:3000')
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Blocked')
  })

  it('rejects private IP URLs', async () => {
    const result = await checkWebVitals('http://192.168.1.1')
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Blocked')
  })

  it('rejects internal TLDs', async () => {
    const result = await checkWebVitals('http://server.local')
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Blocked')
  })

  it('rejects non-http protocols', async () => {
    const result = await checkWebVitals('ftp://example.com')
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Blocked')
  })

  it('returns valid shape on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        lighthouseResult: {
          audits: {
            'largest-contentful-paint': { numericValue: 2500 },
            'interaction-to-paint': { numericValue: 250 },
            'first-input-delay': { numericValue: 100 },  // Legacy, ignored
            'cumulative-layout-shift': { numericValue: 0.1 },
            'first-contentful-paint': { numericValue: 1500 },
            'server-response-time': { numericValue: 400 },
            'speed-index': { numericValue: 3000 },
          },
        },
      }),
    })

    const result = await checkWebVitals('https://example.com')
    expect(result.ok).toBe(true)
    expect(result.lcp).toBe(2500)
    expect(result.fid).toBeNull()  // FID retired
    expect(result.inp).toBe(250)   // INP is the new primary
    expect(result.cls).toBe(0.1)
    expect(result.fcp).toBe(1500)
    expect(result.ttfb).toBe(400)
    expect(result.si).toBe(3000)

    // Validate with Zod schema
    const parsed = WebVitalsResultSchema.safeParse(result)
    expect(parsed.success).toBe(true)
  })

  it('handles PSI API errors gracefully', async () => {
    // 429 triggers retry — mock all 3 attempts as 429
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: { message: 'Rate limit exceeded' },
      }),
    })

    const result = await checkWebVitals('https://example.com')
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('PSI quota exceeded')
    expect(result.detail).toContain('will retry next run')
  })

  it('handles network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const result = await checkWebVitals('https://example.com')
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Network error')
  })

  it('handles timeout errors', async () => {
    const timeoutError = new Error('Timeout')
    timeoutError.name = 'TimeoutError'
    mockFetch.mockRejectedValueOnce(timeoutError)

    const result = await checkWebVitals('https://example.com')
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('timed out')
  })

  it('handles missing audits gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        lighthouseResult: {
          audits: {},
        },
      }),
    })

    const result = await checkWebVitals('https://example.com')
    expect(result.ok).toBe(true)
    expect(result.lcp).toBeNull()
    expect(result.inp).toBeNull()
    expect(result.cls).toBeNull()
  })
})
