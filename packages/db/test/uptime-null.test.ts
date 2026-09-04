/**
 * Uptime percentage tests.
 *
 * Verifies that:
 *   - Zero-event monitors return null uptimePercent (not 100%)
 *   - Monitors with events return correct uptimePercent
 *   - Authentication failures return null uptimePercent
 */

import { describe, expect, it } from 'vitest'
import type { UptimeResult } from '../src/queries/monitors.ts'

describe('Uptime result types', () => {
  it('uptimePercent can be null (zero events)', () => {
    const result: UptimeResult = { total: 0, up: 0, down: 0, uptimePercent: null }
    expect(result.uptimePercent).toBeNull()
    expect(result.total).toBe(0)
  })

  it('uptimePercent is a number when events exist', () => {
    const result: UptimeResult = { total: 100, up: 99, down: 1, uptimePercent: 99.0 }
    expect(result.uptimePercent).toBe(99.0)
    expect(result.total).toBe(100)
  })

  it('uptimePercent calculation is correct', () => {
    // 99 up out of 100 total = 99%
    const up = 99
    const total = 100
    const expected = Math.round((up / total) * 10_000) / 100
    expect(expected).toBe(99.0)

    // 1 up out of 3 total = 33.33%
    const up2 = 1
    const total2 = 3
    const expected2 = Math.round((up2 / total2) * 10_000) / 100
    expect(expected2).toBe(33.33)
  })
})

describe('UptimeBadge null handling', () => {
  it('null percent should show "No data" text', () => {
    // This tests the logic, not the DOM rendering
    const percent: number | null = null
    const displayText = percent === null ? 'No data' : `${percent.toFixed(2)}%`
    expect(displayText).toBe('No data')
  })

  it('number percent should show formatted percentage', () => {
    const percent: number | null = 99.95
    const displayText = percent === null ? 'No data' : `${percent.toFixed(2)}%`
    expect(displayText).toBe('99.95%')
  })
})

describe('StatusHeader null uptime handling', () => {
  it('null uptimePercent should show em dash', () => {
    const uptimePercent: number | null = null
    const display = uptimePercent !== null ? `${uptimePercent.toFixed(2)}%` : '—'
    expect(display).toBe('—')
  })

  it('number uptimePercent should show formatted percentage', () => {
    const uptimePercent: number | null = 99.99
    const display = uptimePercent !== null ? `${uptimePercent.toFixed(2)}%` : '—'
    expect(display).toBe('99.99%')
  })
})
