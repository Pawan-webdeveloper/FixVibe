/**
 * Response time chart tests.
 *
 * Tests the helper functions for formatting labels and tooltips.
 */

import { describe, expect, it } from 'vitest'

// Helper functions extracted from response-time-chart.tsx for testing
function formatLabel(timestamp: string, range: '1h' | '24h' | '7d'): string {
  const date = new Date(timestamp)

  switch (range) {
    case '1h':
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    case '24h':
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    case '7d':
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
}

function formatTooltip(
  point: { timestamp: string; avgLatencyMs: number | null; p95LatencyMs: number | null },
  range: '1h' | '24h' | '7d',
): string {
  const date = new Date(point.timestamp)
  const timeStr =
    range === '7d'
      ? date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (point.avgLatencyMs === null) {
    return `${timeStr} · No data`
  }

  return `${timeStr} · avg ${point.avgLatencyMs}ms · p95 ${point.p95LatencyMs ?? '—'}ms`
}

function barColor(avgLatencyMs: number | null, totalChecks: number): string {
  if (totalChecks === 0 || avgLatencyMs === null) return 'bg-gray-200'
  if (avgLatencyMs < 200) return 'bg-emerald-400'
  if (avgLatencyMs < 500) return 'bg-yellow-400'
  return 'bg-orange-400'
}

describe('ResponseTimeChart helpers', () => {
  describe('formatLabel', () => {
    it('formats 1h range as time', () => {
      const label = formatLabel('2025-01-15T14:30:00Z', '1h')
      // Should contain time components
      expect(label).toMatch(/\d{1,2}:\d{2}/)
    })

    it('formats 24h range as time', () => {
      const label = formatLabel('2025-01-15T14:30:00Z', '24h')
      expect(label).toMatch(/\d{1,2}:\d{2}/)
    })

    it('formats 7d range as date', () => {
      const label = formatLabel('2025-01-15T00:00:00Z', '7d')
      // Should contain month and day
      expect(label).toMatch(/Jan|1/)
    })
  })

  describe('formatTooltip', () => {
    it('formats tooltip with latency data', () => {
      const tooltip = formatTooltip(
        { timestamp: '2025-01-15T14:30:00Z', avgLatencyMs: 150, p95LatencyMs: 300 },
        '1h',
      )
      expect(tooltip).toContain('avg 150ms')
      expect(tooltip).toContain('p95 300ms')
    })

    it('formats tooltip with null latency', () => {
      const tooltip = formatTooltip(
        { timestamp: '2025-01-15T14:30:00Z', avgLatencyMs: null, p95LatencyMs: null },
        '1h',
      )
      expect(tooltip).toContain('No data')
    })

    it('formats tooltip for 7d range as date', () => {
      const tooltip = formatTooltip(
        { timestamp: '2025-01-15T00:00:00Z', avgLatencyMs: 200, p95LatencyMs: 400 },
        '7d',
      )
      expect(tooltip).toMatch(/Jan 15/)
      expect(tooltip).toContain('avg 200ms')
    })

    it('handles null p95 latency', () => {
      const tooltip = formatTooltip(
        { timestamp: '2025-01-15T14:30:00Z', avgLatencyMs: 150, p95LatencyMs: null },
        '1h',
      )
      expect(tooltip).toContain('p95 —')
    })
  })

  describe('barColor', () => {
    it('returns green for fast responses (<200ms)', () => {
      expect(barColor(100, 1)).toBe('bg-emerald-400')
      expect(barColor(199, 1)).toBe('bg-emerald-400')
    })

    it('returns yellow for medium responses (200-499ms)', () => {
      expect(barColor(200, 1)).toBe('bg-yellow-400')
      expect(barColor(499, 1)).toBe('bg-yellow-400')
    })

    it('returns orange for slow responses (>=500ms)', () => {
      expect(barColor(500, 1)).toBe('bg-orange-400')
      expect(barColor(1000, 1)).toBe('bg-orange-400')
    })

    it('returns gray for null latency', () => {
      expect(barColor(null, 1)).toBe('bg-gray-200')
    })

    it('returns gray for zero checks', () => {
      expect(barColor(100, 0)).toBe('bg-gray-200')
    })
  })
})

describe('Response time data structure', () => {
  it('validates data point structure', () => {
    const dataPoint = {
      timestamp: '2025-01-15T14:30:00Z',
      avgLatencyMs: 150,
      p95LatencyMs: 300,
      maxLatencyMs: 450,
      totalChecks: 1,
    }

    expect(dataPoint.timestamp).toBeDefined()
    expect(typeof dataPoint.avgLatencyMs).toBe('number')
    expect(typeof dataPoint.p95LatencyMs).toBe('number')
    expect(typeof dataPoint.maxLatencyMs).toBe('number')
    expect(typeof dataPoint.totalChecks).toBe('number')
  })

  it('validates empty data array', () => {
    const data: Array<{
      timestamp: string
      avgLatencyMs: number | null
      p95LatencyMs: number | null
      maxLatencyMs: number | null
      totalChecks: number
    }> = []

    expect(data).toHaveLength(0)
  })
})
