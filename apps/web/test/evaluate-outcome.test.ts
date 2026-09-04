/**
 * Characterization tests for evaluateOutcome()
 *
 * Purpose: Capture CURRENT behavior of evaluateOutcome() as a safety net
 * before refactoring. These tests document what the function DOES, not
 * necessarily what it SHOULD do.
 *
 * Coverage:
 *   - Default behavior (>=400 = down)
 *   - Custom failStatusCodes
 *   - maxLatencyMs threshold
 *   - Combined status + latency
 *   - Null/undefined handling
 *   - Edge cases
 */

import { describe, expect, it } from 'vitest'
import { evaluateOutcome, type AlertConfig } from '../lib/alert-threshold.ts'

// ─── Default behavior (no alertConfig) ────────────────────────────────────────

describe('evaluateOutcome — default behavior (no config)', () => {
  it('returns ok:true for 200 with normal latency', () => {
    const result = evaluateOutcome({ statusCode: 200, latencyMs: 150 }, null)
    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('returns ok:true for 201 (success)', () => {
    expect(evaluateOutcome({ statusCode: 201, latencyMs: 50 }, null).ok).toBe(true)
  })

  it('returns ok:true for 301 (redirect)', () => {
    expect(evaluateOutcome({ statusCode: 301, latencyMs: 100 }, null).ok).toBe(true)
  })

  it('returns ok:true for 399 (just below threshold)', () => {
    expect(evaluateOutcome({ statusCode: 399, latencyMs: 100 }, null).ok).toBe(true)
  })

  it('returns ok:false for 400 (at threshold)', () => {
    const result = evaluateOutcome({ statusCode: 400, latencyMs: 100 }, null)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('HTTP 400')
  })

  it('returns ok:false for 500', () => {
    expect(evaluateOutcome({ statusCode: 500, latencyMs: 100 }, null).ok).toBe(false)
  })

  it('returns ok:false for 503', () => {
    expect(evaluateOutcome({ statusCode: 503, latencyMs: 100 }, null).ok).toBe(false)
  })

  it('returns ok:true when statusCode is null (no status to evaluate)', () => {
    // null statusCode = status check is skipped entirely
    const result = evaluateOutcome({ statusCode: null, latencyMs: 100 }, null)
    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('returns ok:true when both statusCode and latencyMs are null', () => {
    const result = evaluateOutcome({ statusCode: null, latencyMs: null }, null)
    expect(result.ok).toBe(true)
  })
})

// ─── Custom failStatusCodes ───────────────────────────────────────────────────

describe('evaluateOutcome — custom failStatusCodes (5xx only)', () => {
  const config: AlertConfig = {
    failStatusCodes: [500, 502, 503, 504],
  }

  it('returns ok:false for 500 (in list)', () => {
    expect(evaluateOutcome({ statusCode: 500, latencyMs: 100 }, config).ok).toBe(false)
  })

  it('returns ok:false for 503 (in list)', () => {
    expect(evaluateOutcome({ statusCode: 503, latencyMs: 100 }, config).ok).toBe(false)
  })

  it('returns ok:true for 400 (not in list)', () => {
    // Custom list overrides default >=400 behavior
    expect(evaluateOutcome({ statusCode: 400, latencyMs: 100 }, config).ok).toBe(true)
  })

  it('returns ok:true for 404 (not in list)', () => {
    expect(evaluateOutcome({ statusCode: 404, latencyMs: 100 }, config).ok).toBe(true)
  })

  it('returns ok:true for 499 (not in list)', () => {
    expect(evaluateOutcome({ statusCode: 499, latencyMs: 100 }, config).ok).toBe(true)
  })

  it('includes HTTP status code in reason when down', () => {
    const result = evaluateOutcome({ statusCode: 502, latencyMs: 100 }, config)
    expect(result.reason).toBe('HTTP 502')
  })

  it('returns ok:true for 501 (not in custom list)', () => {
    // Even though 501 is a 5xx, it's not in our custom list
    expect(evaluateOutcome({ statusCode: 501, latencyMs: 100 }, config).ok).toBe(true)
  })
})

// ─── maxLatencyMs threshold ───────────────────────────────────────────────────

describe('evaluateOutcome — maxLatencyMs threshold', () => {
  const config: AlertConfig = {
    maxLatencyMs: 2000,
  }

  it('returns ok:true when latency is within threshold', () => {
    expect(evaluateOutcome({ statusCode: 200, latencyMs: 1999 }, config).ok).toBe(true)
  })

  it('returns ok:true at exactly the threshold (strictly greater required)', () => {
    // Current behavior: latencyMs > maxLatencyMs, so 2000 is NOT down
    expect(evaluateOutcome({ statusCode: 200, latencyMs: 2000 }, config).ok).toBe(true)
  })

  it('returns ok:false when latency exceeds threshold by 1ms', () => {
    const result = evaluateOutcome({ statusCode: 200, latencyMs: 2001 }, config)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('2001ms')
    expect(result.reason).toContain('2000ms')
  })

  it('returns ok:true when latencyMs is null (no data)', () => {
    // null latency = latency check is skipped
    expect(evaluateOutcome({ statusCode: 200, latencyMs: null }, config).ok).toBe(true)
  })

  it('returns ok:true when maxLatencyMs is null (threshold disabled)', () => {
    const noLatencyConfig: AlertConfig = { maxLatencyMs: null }
    expect(evaluateOutcome({ statusCode: 200, latencyMs: 5000 }, noLatencyConfig).ok).toBe(true)
  })

  it('includes latency details in reason when down', () => {
    const result = evaluateOutcome({ statusCode: 200, latencyMs: 3000 }, config)
    expect(result.reason).toContain('3000ms')
    expect(result.reason).toContain('2000ms threshold')
  })
})

// ─── Combined status + latency ────────────────────────────────────────────────

describe('evaluateOutcome — combined status + latency thresholds', () => {
  const config: AlertConfig = {
    failStatusCodes: [500, 503],
    maxLatencyMs: 1000,
  }

  it('fires both reasons when both thresholds violated', () => {
    const result = evaluateOutcome({ statusCode: 503, latencyMs: 1500 }, config)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('HTTP 503')
    expect(result.reason).toContain('1500ms')
  })

  it('fires only latency when status is fine', () => {
    const result = evaluateOutcome({ statusCode: 200, latencyMs: 1500 }, config)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('1500ms')
    expect(result.reason).not.toContain('HTTP')
  })

  it('fires only status when latency is fine', () => {
    const result = evaluateOutcome({ statusCode: 503, latencyMs: 500 }, config)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('HTTP 503')
    expect(result.reason).not.toContain('ms')
  })

  it('returns ok:true when both within range', () => {
    const result = evaluateOutcome({ statusCode: 200, latencyMs: 999 }, config)
    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('reasons are comma-separated when both fire', () => {
    const result = evaluateOutcome({ statusCode: 500, latencyMs: 2000 }, config)
    expect(result.reason).toMatch(/HTTP 500, \d+ms/)
  })
})

// ─── undefined vs null config ─────────────────────────────────────────────────

describe('evaluateOutcome — undefined vs null config', () => {
  it('behaves identically with undefined config', () => {
    const withNull = evaluateOutcome({ statusCode: 500, latencyMs: 100 }, null)
    const withUndefined = evaluateOutcome({ statusCode: 500, latencyMs: 100 }, undefined)
    expect(withNull).toEqual(withUndefined)
  })

  it('uses default >=400 logic when config is undefined', () => {
    expect(evaluateOutcome({ statusCode: 400, latencyMs: 100 }, undefined).ok).toBe(false)
    expect(evaluateOutcome({ statusCode: 399, latencyMs: 100 }, undefined).ok).toBe(true)
  })
})

// ─── Empty failStatusCodes array ──────────────────────────────────────────────

describe('evaluateOutcome — empty failStatusCodes array', () => {
  it('falls back to default >=400 logic when array is empty', () => {
    const config: AlertConfig = { failStatusCodes: [] }
    // Empty array = no custom codes = default behavior
    expect(evaluateOutcome({ statusCode: 400, latencyMs: 100 }, config).ok).toBe(false)
    expect(evaluateOutcome({ statusCode: 399, latencyMs: 100 }, config).ok).toBe(true)
  })
})

// ─── Boundary status codes ────────────────────────────────────────────────────

describe('evaluateOutcome — boundary status codes', () => {
  it('handles 100 (informational)', () => {
    expect(evaluateOutcome({ statusCode: 100, latencyMs: 100 }, null).ok).toBe(true)
  })

  it('handles 200 (OK)', () => {
    expect(evaluateOutcome({ statusCode: 200, latencyMs: 100 }, null).ok).toBe(true)
  })

  it('handles 599 (highest valid status)', () => {
    expect(evaluateOutcome({ statusCode: 599, latencyMs: 100 }, null).ok).toBe(false)
  })

  it('handles 0 (invalid but possible from network error)', () => {
    // statusCode 0 is < 400, so default says ok
    expect(evaluateOutcome({ statusCode: 0, latencyMs: 100 }, null).ok).toBe(true)
  })
})

// ─── non_200 preset fix ──────────────────────────────────────────────────────

describe('evaluateOutcome — non_200 preset (fixed)', () => {
  const non200Config: AlertConfig = {
    failStatusCodes: Array.from({ length: 200 }, (_, i) => 400 + i),
  }

  it('does NOT alert on 201 (Created) — valid success response', () => {
    expect(evaluateOutcome({ statusCode: 201, latencyMs: 50 }, non200Config).ok).toBe(true)
  })

  it('does NOT alert on 202 (Accepted) — valid success response', () => {
    expect(evaluateOutcome({ statusCode: 202, latencyMs: 50 }, non200Config).ok).toBe(true)
  })

  it('does NOT alert on 204 (No Content) — valid success response', () => {
    expect(evaluateOutcome({ statusCode: 204, latencyMs: 50 }, non200Config).ok).toBe(true)
  })

  it('does NOT alert on 301 (Redirect) — valid non-error response', () => {
    expect(evaluateOutcome({ statusCode: 301, latencyMs: 50 }, non200Config).ok).toBe(true)
  })

  it('does NOT alert on 399 (just below 400 threshold)', () => {
    expect(evaluateOutcome({ statusCode: 399, latencyMs: 50 }, non200Config).ok).toBe(true)
  })

  it('ALERTS on 400 (Bad Request) — client error', () => {
    expect(evaluateOutcome({ statusCode: 400, latencyMs: 50 }, non200Config).ok).toBe(false)
  })

  it('ALERTS on 404 (Not Found) — client error', () => {
    expect(evaluateOutcome({ statusCode: 404, latencyMs: 50 }, non200Config).ok).toBe(false)
  })

  it('ALERTS on 500 (Internal Server Error) — server error', () => {
    expect(evaluateOutcome({ statusCode: 500, latencyMs: 50 }, non200Config).ok).toBe(false)
  })

  it('ALERTS on 503 (Service Unavailable) — server error', () => {
    expect(evaluateOutcome({ statusCode: 503, latencyMs: 50 }, non200Config).ok).toBe(false)
  })
})
