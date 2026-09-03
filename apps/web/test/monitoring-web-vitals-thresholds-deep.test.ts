/**
 * Deep tests for Web Vitals Thresholds and Evaluation.
 *
 * Tests the FULL evaluateVitals() and formatVitalValue() logic from
 * web-vitals-thresholds.ts covering:
 *   1. All 6 metrics: LCP, FID, CLS, FCP, TTFB, SI
 *   2. All 3 states per metric: good (no violation), warn, critical
 *   3. Exact boundary values (at warn, just below, just above)
 *   4. hasCritical / hasWarn flags
 *   5. Violations sorted: critical before warn
 *   6. Missing / null metrics gracefully skipped (no false alert)
 *   7. All-null input → empty violations
 *   8. formatVitalValue — CLS gets 3dp, others get unit suffix
 *   9. Mixed violations: some warn, some critical
 *  10. Invalid input (e.g. string) gracefully returns []
 */

import { describe, expect, it } from 'vitest'
import {
  evaluateVitals,
  formatVitalValue,
  THRESHOLDS,
} from '../lib/web-vitals-thresholds.ts'

// ─── Threshold Boundary Tests per Metric ─────────────────────────────────────

describe('evaluateVitals — LCP thresholds (warn: 2500ms, critical: 4000ms)', () => {
  it('good: LCP = 2499ms → no violation', () => {
    const r = evaluateVitals({ lcp: 2499 })
    expect(r.violations).toHaveLength(0)
    expect(r.hasCritical).toBe(false)
    expect(r.hasWarn).toBe(false)
  })

  it('boundary: LCP = 2500ms → warn', () => {
    const r = evaluateVitals({ lcp: 2500 })
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0]!.severity).toBe('warn')
    expect(r.violations[0]!.key).toBe('lcp')
    expect(r.violations[0]!.metric).toBe('LCP')
    expect(r.hasWarn).toBe(true)
    expect(r.hasCritical).toBe(false)
  })

  it('boundary: LCP = 3999ms → still warn', () => {
    const r = evaluateVitals({ lcp: 3999 })
    expect(r.violations[0]!.severity).toBe('warn')
  })

  it('boundary: LCP = 4000ms → critical', () => {
    const r = evaluateVitals({ lcp: 4000 })
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0]!.severity).toBe('critical')
    expect(r.hasCritical).toBe(true)
  })

  it('LCP = 6000ms → critical', () => {
    const r = evaluateVitals({ lcp: 6000 })
    expect(r.violations[0]!.severity).toBe('critical')
  })
})

describe('evaluateVitals — FID thresholds (warn: 100ms, critical: 300ms)', () => {
  it('good: FID = 99ms → no violation', () =>
    expect(evaluateVitals({ fid: 99 }).violations).toHaveLength(0))

  it('boundary: FID = 100ms → warn', () => {
    const r = evaluateVitals({ fid: 100 })
    expect(r.violations[0]!.severity).toBe('warn')
    expect(r.violations[0]!.key).toBe('fid')
  })

  it('FID = 299ms → warn', () =>
    expect(evaluateVitals({ fid: 299 }).violations[0]!.severity).toBe('warn'))

  it('boundary: FID = 300ms → critical', () => {
    const r = evaluateVitals({ fid: 300 })
    expect(r.violations[0]!.severity).toBe('critical')
    expect(r.hasCritical).toBe(true)
  })
})

describe('evaluateVitals — CLS thresholds (warn: 0.1, critical: 0.25)', () => {
  it('good: CLS = 0.09 → no violation', () =>
    expect(evaluateVitals({ cls: 0.09 }).violations).toHaveLength(0))

  it('boundary: CLS = 0.1 → warn', () => {
    const r = evaluateVitals({ cls: 0.1 })
    expect(r.violations[0]!.severity).toBe('warn')
    expect(r.violations[0]!.unit).toBe('')  // CLS has no unit
  })

  it('boundary: CLS = 0.25 → critical', () => {
    const r = evaluateVitals({ cls: 0.25 })
    expect(r.violations[0]!.severity).toBe('critical')
  })

  it('CLS = 0.5 → critical', () =>
    expect(evaluateVitals({ cls: 0.5 }).violations[0]!.severity).toBe('critical'))
})

describe('evaluateVitals — FCP thresholds (warn: 1800ms, critical: 3000ms)', () => {
  it('good: FCP = 1799ms → no violation', () =>
    expect(evaluateVitals({ fcp: 1799 }).violations).toHaveLength(0))

  it('boundary: FCP = 1800ms → warn', () =>
    expect(evaluateVitals({ fcp: 1800 }).violations[0]!.severity).toBe('warn'))

  it('boundary: FCP = 3000ms → critical', () =>
    expect(evaluateVitals({ fcp: 3000 }).violations[0]!.severity).toBe('critical'))
})

describe('evaluateVitals — TTFB thresholds (warn: 800ms, critical: 1800ms)', () => {
  it('good: TTFB = 799ms → no violation', () =>
    expect(evaluateVitals({ ttfb: 799 }).violations).toHaveLength(0))

  it('boundary: TTFB = 800ms → warn', () =>
    expect(evaluateVitals({ ttfb: 800 }).violations[0]!.severity).toBe('warn'))

  it('boundary: TTFB = 1800ms → critical', () =>
    expect(evaluateVitals({ ttfb: 1800 }).violations[0]!.severity).toBe('critical'))
})

describe('evaluateVitals — SI thresholds (warn: 3400ms, critical: 5800ms)', () => {
  it('good: SI = 3399ms → no violation', () =>
    expect(evaluateVitals({ si: 3399 }).violations).toHaveLength(0))

  it('boundary: SI = 3400ms → warn', () =>
    expect(evaluateVitals({ si: 3400 }).violations[0]!.severity).toBe('warn'))

  it('boundary: SI = 5800ms → critical', () =>
    expect(evaluateVitals({ si: 5800 }).violations[0]!.severity).toBe('critical'))
})

// ─── Multi-Metric + Sorting ────────────────────────────────────────────────────

describe('evaluateVitals — multi-metric and sorting', () => {
  it('all good → no violations, hasCritical=false, hasWarn=false', () => {
    const r = evaluateVitals({ lcp: 1000, fid: 50, cls: 0.05, fcp: 1000, ttfb: 500, si: 2000 })
    expect(r.violations).toHaveLength(0)
    expect(r.hasCritical).toBe(false)
    expect(r.hasWarn).toBe(false)
  })

  it('all critical → hasCritical=true, violations sorted critical first', () => {
    const r = evaluateVitals({ lcp: 5000, fid: 400, cls: 0.3, fcp: 4000, ttfb: 2000, si: 6000 })
    expect(r.hasCritical).toBe(true)
    for (const v of r.violations) {
      expect(v.severity).toBe('critical')
    }
  })

  it('mix of warn and critical — critical sorted first', () => {
    const r = evaluateVitals({ lcp: 5000, fid: 150 })  // lcp=critical, fid=warn
    expect(r.violations).toHaveLength(2)
    expect(r.violations[0]!.severity).toBe('critical')
    expect(r.violations[0]!.key).toBe('lcp')
    expect(r.violations[1]!.severity).toBe('warn')
    expect(r.violations[1]!.key).toBe('fid')
  })

  it('violation has all required fields', () => {
    const r = evaluateVitals({ lcp: 5000 })
    const v = r.violations[0]!
    expect(v.key).toBe('lcp')
    expect(v.metric).toBe('LCP')
    expect(typeof v.value).toBe('number')
    expect(typeof v.warn).toBe('number')
    expect(typeof v.critical).toBe('number')
    expect(v.unit).toBe('ms')
    expect(['warn', 'critical']).toContain(v.severity)
  })
})

// ─── Null / Missing Metrics ────────────────────────────────────────────────────

describe('evaluateVitals — null and missing metrics', () => {
  it('all null metrics → no violations (never false-alert on missing data)', () => {
    const r = evaluateVitals({ lcp: null, fid: null, cls: null, fcp: null, ttfb: null, si: null })
    expect(r.violations).toHaveLength(0)
  })

  it('empty object → no violations', () => {
    const r = evaluateVitals({})
    expect(r.violations).toHaveLength(0)
  })

  it('undefined metric is skipped, other metrics still evaluated', () => {
    // lcp undefined → skipped; ttfb=2000 = critical
    const r = evaluateVitals({ ttfb: 2000 })
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0]!.key).toBe('ttfb')
  })

  it('null for one metric, valid for another', () => {
    const r = evaluateVitals({ lcp: null, fid: 400 })  // fid=critical
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0]!.key).toBe('fid')
  })
})

// ─── Invalid Input ─────────────────────────────────────────────────────────────

describe('evaluateVitals — invalid input gracefully handled', () => {
  it('string instead of number → returns empty violations (Zod catches it)', () => {
    // @ts-expect-error — intentional bad input
    const r = evaluateVitals({ lcp: 'fast' })
    expect(r.violations).toHaveLength(0)
    expect(r.hasCritical).toBe(false)
  })
})

// ─── formatVitalValue ─────────────────────────────────────────────────────────

describe('formatVitalValue', () => {
  it('LCP uses ms unit', () =>
    expect(formatVitalValue('lcp', 2500)).toBe('2500ms'))

  it('FID uses ms unit', () =>
    expect(formatVitalValue('fid', 150)).toBe('150ms'))

  it('CLS uses 3 decimal places (no unit)', () => {
    expect(formatVitalValue('cls', 0.1)).toBe('0.100')
    expect(formatVitalValue('cls', 0.25)).toBe('0.250')
    expect(formatVitalValue('cls', 0.001)).toBe('0.001')
  })

  it('FCP uses ms unit', () =>
    expect(formatVitalValue('fcp', 3000)).toBe('3000ms'))

  it('TTFB uses ms unit', () =>
    expect(formatVitalValue('ttfb', 800)).toBe('800ms'))

  it('SI uses ms unit', () =>
    expect(formatVitalValue('si', 5000)).toBe('5000ms'))
})

// ─── THRESHOLDS export sanity ─────────────────────────────────────────────────

describe('THRESHOLDS export', () => {
  it('exports thresholds for all 6 keys', () => {
    const keys = Object.keys(THRESHOLDS)
    expect(keys).toContain('lcp')
    expect(keys).toContain('fid')
    expect(keys).toContain('cls')
    expect(keys).toContain('fcp')
    expect(keys).toContain('ttfb')
    expect(keys).toContain('si')
  })

  it('Google official LCP threshold values', () => {
    expect(THRESHOLDS.lcp.warn).toBe(2500)
    expect(THRESHOLDS.lcp.critical).toBe(4000)
  })

  it('Google official CLS threshold values', () => {
    expect(THRESHOLDS.cls.warn).toBe(0.1)
    expect(THRESHOLDS.cls.critical).toBe(0.25)
  })

  it('critical always > warn for every metric', () => {
    for (const [, t] of Object.entries(THRESHOLDS)) {
      expect(t.critical).toBeGreaterThan(t.warn)
    }
  })
})
