/**
 * Web Vitals thresholds and evaluation tests.
 *
 * Tests the Core Web Vitals threshold logic that determines
 * when to fire alerts based on Google's official thresholds.
 */

import { describe, expect, it } from 'vitest'
import {
  evaluateVitals,
  formatVitalValue,
  type VitalsInput,
  type Violation,
} from '../lib/web-vitals-thresholds.ts'

describe('evaluateVitals', () => {
  it('returns no violations when all metrics are within thresholds', () => {
    const vitals: VitalsInput = {
      lcp: 1500,   // Good: < 2500ms
      fid: 50,     // Good: < 100ms
      cls: 0.05,   // Good: < 0.1
      fcp: 1000,   // Good: < 1800ms
      ttfb: 400,   // Good: < 800ms
      si: 2000,    // Good: < 3400ms
    }
    const result = evaluateVitals(vitals)
    expect(result.violations).toHaveLength(0)
    expect(result.hasCritical).toBe(false)
    expect(result.hasWarn).toBe(false)
  })

  it('detects critical LCP violation', () => {
    const vitals: VitalsInput = { lcp: 4500 } // Critical: >= 4000ms
    const result = evaluateVitals(vitals)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]?.severity).toBe('critical')
    expect(result.violations[0]?.key).toBe('lcp')
    expect(result.hasCritical).toBe(true)
  })

  it('detects warn LCP violation', () => {
    const vitals: VitalsInput = { lcp: 3000 } // Warn: >= 2500ms
    const result = evaluateVitals(vitals)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]?.severity).toBe('warn')
    expect(result.hasWarn).toBe(true)
  })

  it('detects multiple violations', () => {
    const vitals: VitalsInput = {
      lcp: 4500,  // Critical
      cls: 0.3,   // Critical
      fid: 150,   // Warn
    }
    const result = evaluateVitals(vitals)
    expect(result.violations).toHaveLength(3)
    expect(result.hasCritical).toBe(true)
    expect(result.hasWarn).toBe(true)
    // Critical violations should come first
    expect(result.violations[0]?.severity).toBe('critical')
    expect(result.violations[1]?.severity).toBe('critical')
    expect(result.violations[2]?.severity).toBe('warn')
  })

  it('skips null/undefined metrics', () => {
    const vitals: VitalsInput = {
      lcp: null,
      fid: undefined,
      cls: 0.3, // Critical
    }
    const result = evaluateVitals(vitals)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]?.key).toBe('cls')
  })

  it('handles empty input', () => {
    const result = evaluateVitals({})
    expect(result.violations).toHaveLength(0)
    expect(result.hasCritical).toBe(false)
    expect(result.hasWarn).toBe(false)
  })

  it('detects all critical thresholds', () => {
    const vitals: VitalsInput = {
      lcp: 4000,   // Critical
      fid: 300,    // Critical
      cls: 0.25,   // Critical
      fcp: 3000,   // Critical
      ttfb: 1800,  // Critical
      si: 5800,    // Critical
    }
    const result = evaluateVitals(vitals)
    expect(result.violations).toHaveLength(6)
    expect(result.violations.every((v) => v.severity === 'critical')).toBe(true)
  })
})

describe('formatVitalValue', () => {
  it('formats LCP with ms suffix', () => {
    expect(formatVitalValue('lcp', 2500)).toBe('2500ms')
  })

  it('formats CLS with 3 decimal places', () => {
    expect(formatVitalValue('cls', 0.123456)).toBe('0.123')
  })

  it('formats FID with ms suffix', () => {
    expect(formatVitalValue('fid', 100)).toBe('100ms')
  })

  it('formats TTFB with ms suffix', () => {
    expect(formatVitalValue('ttfb', 800)).toBe('800ms')
  })

  it('formats SI with ms suffix', () => {
    expect(formatVitalValue('si', 3400)).toBe('3400ms')
  })

  it('formats FCP with ms suffix', () => {
    expect(formatVitalValue('fcp', 1800)).toBe('1800ms')
  })
})
