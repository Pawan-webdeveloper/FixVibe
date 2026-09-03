/**
 * alert-threshold.ts tests.
 *
 * Tests the severity-threshold feature: custom failStatusCodes and
 * maxLatencyMs that change when a monitor counts as "down".
 *
 * This is pure business logic — no DB, no network, fully deterministic.
 * Most important cases:
 *   - Default behaviour (no config) mirrors what uptime-probe did before
 *   - Custom failStatusCodes only fire on listed codes
 *   - maxLatencyMs fires when latency exceeds the threshold
 *   - Both can fire together (combined reason string)
 *   - parseAlertConfig validates user-supplied JSON correctly
 */

import { describe, expect, it } from 'vitest'
import {
  evaluateOutcome,
  parseAlertConfig,
  AlertConfigSchema,
  type AlertConfig,
} from '../lib/alert-threshold.ts'

// ─── evaluateOutcome — default behaviour (no config) ─────────────────────────

describe('evaluateOutcome — default behaviour (no alertConfig)', () => {
  it('is UP for a 200 response', () => {
    expect(evaluateOutcome({ statusCode: 200, latencyMs: 100 }, null)).toMatchObject({
      ok: true,
    })
  })

  it('is UP for a 301 redirect', () => {
    expect(evaluateOutcome({ statusCode: 301, latencyMs: 50 }, null).ok).toBe(true)
  })

  it('is DOWN for a 400', () => {
    const result = evaluateOutcome({ statusCode: 400, latencyMs: 100 }, null)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('HTTP 400')
  })

  it('is DOWN for a 500', () => {
    expect(evaluateOutcome({ statusCode: 500, latencyMs: 100 }, null).ok).toBe(false)
  })

  it('is DOWN for a 503', () => {
    expect(evaluateOutcome({ statusCode: 503, latencyMs: 100 }, null).ok).toBe(false)
  })

  it('is UP when statusCode is null (network error handled separately)', () => {
    // When statusCode is null and no config, status check is skipped
    // latencyMs check also skipped when no maxLatencyMs
    expect(evaluateOutcome({ statusCode: null, latencyMs: 100 }, null).ok).toBe(true)
  })
})

// ─── evaluateOutcome — custom failStatusCodes ─────────────────────────────────

describe('evaluateOutcome — custom failStatusCodes (5xx_only preset)', () => {
  const config: AlertConfig = {
    failStatusCodes: [500, 502, 503, 504],
  }

  it('is DOWN for a 500', () => {
    expect(evaluateOutcome({ statusCode: 500, latencyMs: 100 }, config).ok).toBe(false)
  })

  it('is DOWN for a 503', () => {
    expect(evaluateOutcome({ statusCode: 503, latencyMs: 100 }, config).ok).toBe(false)
  })

  it('is UP for a 404 (not in list)', () => {
    // Custom list = 404 is NOT considered down
    expect(evaluateOutcome({ statusCode: 404, latencyMs: 100 }, config).ok).toBe(true)
  })

  it('is UP for a 400', () => {
    expect(evaluateOutcome({ statusCode: 400, latencyMs: 100 }, config).ok).toBe(true)
  })

  it('reason string includes the HTTP status code', () => {
    const result = evaluateOutcome({ statusCode: 503, latencyMs: 100 }, config)
    expect(result.reason).toContain('HTTP 503')
  })
})

// ─── evaluateOutcome — maxLatencyMs threshold ─────────────────────────────────

describe('evaluateOutcome — maxLatencyMs threshold', () => {
  const config: AlertConfig = {
    maxLatencyMs: 2000,
  }

  it('is UP when latency is within threshold', () => {
    expect(evaluateOutcome({ statusCode: 200, latencyMs: 1999 }, config).ok).toBe(true)
  })

  it('is UP at exactly the threshold (not strictly greater)', () => {
    expect(evaluateOutcome({ statusCode: 200, latencyMs: 2000 }, config).ok).toBe(true)
  })

  it('is DOWN when latency exceeds threshold', () => {
    const result = evaluateOutcome({ statusCode: 200, latencyMs: 2001 }, config)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('2001ms')
    expect(result.reason).toContain('2000ms')
  })

  it('is UP when latencyMs is null (no latency data)', () => {
    expect(evaluateOutcome({ statusCode: 200, latencyMs: null }, config).ok).toBe(true)
  })
})

// ─── evaluateOutcome — combined threshold (status + latency) ─────────────────

describe('evaluateOutcome — status + latency both configured', () => {
  const config: AlertConfig = {
    failStatusCodes: [500, 503],
    maxLatencyMs: 1000,
  }

  it('fires both status and latency reasons when both violated', () => {
    const result = evaluateOutcome({ statusCode: 503, latencyMs: 1500 }, config)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('HTTP 503')
    expect(result.reason).toContain('1500ms')
  })

  it('fires only latency when status is fine but latency exceeded', () => {
    const result = evaluateOutcome({ statusCode: 200, latencyMs: 1500 }, config)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('1500ms')
    expect(result.reason).not.toContain('HTTP 200')
  })

  it('fires only status when latency is fine but status is in fail list', () => {
    const result = evaluateOutcome({ statusCode: 503, latencyMs: 500 }, config)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('HTTP 503')
    expect(result.reason).not.toContain('500ms')
  })

  it('is UP when both are within range', () => {
    expect(evaluateOutcome({ statusCode: 200, latencyMs: 999 }, config).ok).toBe(true)
  })
})

// ─── parseAlertConfig — schema validation ────────────────────────────────────

describe('parseAlertConfig', () => {
  it('accepts an empty object (all fields optional)', () => {
    const result = parseAlertConfig({})
    expect(result.ok).toBe(true)
  })

  it('accepts valid failStatusCodes', () => {
    const result = parseAlertConfig({ failStatusCodes: [500, 502, 503] })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.failStatusCodes).toEqual([500, 502, 503])
  })

  it('accepts a valid maxLatencyMs', () => {
    const result = parseAlertConfig({ maxLatencyMs: 3000 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.maxLatencyMs).toBe(3000)
  })

  it('rejects status codes below 100', () => {
    expect(parseAlertConfig({ failStatusCodes: [99] }).ok).toBe(false)
  })

  it('rejects status codes above 599', () => {
    expect(parseAlertConfig({ failStatusCodes: [600] }).ok).toBe(false)
  })

  it('rejects maxLatencyMs below 100ms (noise threshold)', () => {
    expect(parseAlertConfig({ maxLatencyMs: 50 }).ok).toBe(false)
  })

  it('rejects maxLatencyMs above 60000ms (meaningless — probe times out at 15s)', () => {
    expect(parseAlertConfig({ maxLatencyMs: 60001 }).ok).toBe(false)
  })

  it('rejects non-integer latency', () => {
    expect(parseAlertConfig({ maxLatencyMs: 1500.5 }).ok).toBe(false)
  })

  it('rejects a list with more than 50 status codes', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => 400 + i)
    expect(parseAlertConfig({ failStatusCodes: tooMany }).ok).toBe(false)
  })

  it('rejects non-object input', () => {
    expect(parseAlertConfig('bad input').ok).toBe(false)
    expect(parseAlertConfig(null).ok).toBe(false)
    expect(parseAlertConfig(42).ok).toBe(false)
  })

  it('accepts null maxLatencyMs explicitly (means no latency threshold)', () => {
    const result = parseAlertConfig({ maxLatencyMs: null })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config.maxLatencyMs).toBeNull()
  })
})

// ─── AlertConfigSchema — Zod direct ──────────────────────────────────────────

describe('AlertConfigSchema (Zod)', () => {
  it('strips unknown fields (does not pass through extra keys)', () => {
    const result = AlertConfigSchema.safeParse({
      failStatusCodes: [500],
      unknownField: 'should be stripped',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect('unknownField' in result.data).toBe(false)
    }
  })
})
