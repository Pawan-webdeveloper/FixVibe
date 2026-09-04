/**
 * Characterization tests for toDays() — uptime calculation
 *
 * Purpose: Capture CURRENT behavior as a safety net before refactoring.
 * This function groups uptime events into daily buckets for the status strip.
 *
 * Coverage:
 *   - UTC day grouping
 *   - Success/failure counting
 *   - Oldest-first ordering
 *   - Windowing (days parameter)
 *   - Serialized timestamps
 *   - Empty input
 *   - Mixed sequences
 *   - Boundary conditions
 */

import { describe, expect, it } from 'vitest'
import { toDays, type UptimeDay } from '../components/monitors/uptime-days.ts'

// ─── Helper ───────────────────────────────────────────────────────────────────

const at = (iso: string, ok: boolean) => ({ ts: new Date(iso), ok })

// ─── UTC day grouping ─────────────────────────────────────────────────────────

describe('toDays — UTC day grouping', () => {
  it('groups events on the same UTC day', () => {
    const days = toDays([
      at('2026-08-24T01:00:00Z', true),
      at('2026-08-24T23:00:00Z', true),
    ])
    expect(days).toEqual([{ date: '2026-08-24', ok: 2, failed: 0 }])
  })

  it('separates events across UTC midnight', () => {
    const days = toDays([
      at('2026-08-24T23:00:00Z', true),
      at('2026-08-25T01:00:00Z', true),
    ])
    expect(days).toHaveLength(2)
    expect(days[0]?.date).toBe('2026-08-24')
    expect(days[1]?.date).toBe('2026-08-25')
  })

  it('handles events near UTC midnight correctly', () => {
    // 23:59:59 UTC and 00:00:01 UTC are different days
    const days = toDays([
      at('2026-08-24T23:59:59Z', true),
      at('2026-08-25T00:00:01Z', true),
    ])
    expect(days).toHaveLength(2)
  })
})

// ─── Success/failure counting ─────────────────────────────────────────────────

describe('toDays — success/failure counting', () => {
  it('counts successes and failures separately', () => {
    const days = toDays([
      at('2026-08-24T01:00:00Z', true),
      at('2026-08-24T02:00:00Z', false),
      at('2026-08-24T03:00:00Z', false),
    ])
    expect(days[0]).toEqual({ date: '2026-08-24', ok: 1, failed: 2 })
  })

  it('handles all successes in a day', () => {
    const days = toDays([
      at('2026-08-24T01:00:00Z', true),
      at('2026-08-24T02:00:00Z', true),
      at('2026-08-24T03:00:00Z', true),
    ])
    expect(days[0]).toEqual({ date: '2026-08-24', ok: 3, failed: 0 })
  })

  it('handles all failures in a day', () => {
    const days = toDays([
      at('2026-08-24T01:00:00Z', false),
      at('2026-08-24T02:00:00Z', false),
    ])
    expect(days[0]).toEqual({ date: '2026-08-24', ok: 0, failed: 2 })
  })
})

// ─── Oldest-first ordering ────────────────────────────────────────────────────

describe('toDays — oldest-first ordering', () => {
  it('returns days sorted oldest-first regardless of input order', () => {
    // Input is newest-first (as from DB query)
    const days = toDays([
      at('2026-08-24T00:00:00Z', true),
      at('2026-08-22T00:00:00Z', true),
      at('2026-08-23T00:00:00Z', true),
    ])
    expect(days.map((d) => d.date)).toEqual([
      '2026-08-22',
      '2026-08-23',
      '2026-08-24',
    ])
  })

  it('handles reverse chronological input', () => {
    const days = toDays([
      at('2026-08-25T00:00:00Z', true),
      at('2026-08-24T00:00:00Z', true),
      at('2026-08-23T00:00:00Z', true),
    ])
    expect(days.map((d) => d.date)).toEqual([
      '2026-08-23',
      '2026-08-24',
      '2026-08-25',
    ])
  })
})

// ─── Windowing (days parameter) ───────────────────────────────────────────────

describe('toDays — windowing', () => {
  it('keeps only the most recent N days', () => {
    const events = Array.from({ length: 120 }, (_, i) =>
      at(new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), true),
    )
    const days = toDays(events, 90)
    expect(days).toHaveLength(90)
    expect(days.at(-1)?.date).toBe('2026-04-30')
  })

  it('defaults to 90 days', () => {
    const events = Array.from({ length: 100 }, (_, i) =>
      at(new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), true),
    )
    const days = toDays(events)
    expect(days).toHaveLength(90)
  })

  it('handles custom window size', () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      at(new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), true),
    )
    const days = toDays(events, 7)
    expect(days).toHaveLength(7)
  })
})

// ─── Serialized timestamps ────────────────────────────────────────────────────

describe('toDays — serialized timestamps', () => {
  it('accepts ISO string timestamps', () => {
    const days = toDays([{ ts: '2026-08-24T10:00:00.000Z', ok: true }])
    expect(days[0]?.date).toBe('2026-08-24')
  })

  it('accepts Date objects', () => {
    const days = toDays([{ ts: new Date('2026-08-24T10:00:00Z'), ok: true }])
    expect(days[0]?.date).toBe('2026-08-24')
  })

  it('handles mixed Date and string timestamps', () => {
    const days = toDays([
      { ts: '2026-08-24T10:00:00Z', ok: true },
      { ts: new Date('2026-08-24T11:00:00Z'), ok: true },
    ])
    expect(days).toHaveLength(1)
    expect(days[0]?.ok).toBe(2)
  })
})

// ─── Empty input ──────────────────────────────────────────────────────────────

describe('toDays — empty input', () => {
  it('returns empty array for no events', () => {
    expect(toDays([])).toEqual([])
  })

  it('returns empty array with custom window for no events', () => {
    expect(toDays([], 30)).toEqual([])
  })
})

// ─── Single event ─────────────────────────────────────────────────────────────

describe('toDays — single event', () => {
  it('handles a single successful event', () => {
    const days = toDays([at('2026-08-24T12:00:00Z', true)])
    expect(days).toEqual([{ date: '2026-08-24', ok: 1, failed: 0 }])
  })

  it('handles a single failed event', () => {
    const days = toDays([at('2026-08-24T12:00:00Z', false)])
    expect(days).toEqual([{ date: '2026-08-24', ok: 0, failed: 1 }])
  })
})

// ─── Multi-day sequences ──────────────────────────────────────────────────────

describe('toDays — multi-day sequences', () => {
  it('handles a week of mixed results', () => {
    const events = [
      at('2026-08-20T10:00:00Z', true),
      at('2026-08-21T10:00:00Z', false),
      at('2026-08-22T10:00:00Z', true),
      at('2026-08-23T10:00:00Z', true),
      at('2026-08-24T10:00:00Z', false),
      at('2026-08-25T10:00:00Z', true),
      at('2026-08-26T10:00:00Z', true),
    ]
    const days = toDays(events)
    expect(days).toHaveLength(7)
    expect(days[0]?.date).toBe('2026-08-20')
    expect(days[6]?.date).toBe('2026-08-26')
  })

  it('handles gaps in days (no events on some days)', () => {
    const events = [
      at('2026-08-20T10:00:00Z', true),
      // Aug 21-23: no events
      at('2026-08-24T10:00:00Z', true),
    ]
    const days = toDays(events)
    // Only days with events appear
    expect(days).toHaveLength(2)
    expect(days.map((d) => d.date)).toEqual(['2026-08-20', '2026-08-24'])
  })
})

// ─── Uptime calculation contract ──────────────────────────────────────────────

describe('toDays — uptime calculation contract', () => {
  it('returns correct counts for uptime percentage calculation', () => {
    // 3 ok, 1 failed on same day → 75% uptime for that day
    const days = toDays([
      at('2026-08-24T01:00:00Z', true),
      at('2026-08-24T02:00:00Z', true),
      at('2026-08-24T03:00:00Z', true),
      at('2026-08-24T04:00:00Z', false),
    ])
    expect(days[0]).toEqual({ date: '2026-08-24', ok: 3, failed: 1 })
  })

  it('preserves counts across multiple days', () => {
    const days = toDays([
      at('2026-08-23T10:00:00Z', true),
      at('2026-08-23T11:00:00Z', true),
      at('2026-08-24T10:00:00Z', false),
      at('2026-08-24T11:00:00Z', false),
    ])
    expect(days[0]?.ok).toBe(2)
    expect(days[0]?.failed).toBe(0)
    expect(days[1]?.ok).toBe(0)
    expect(days[1]?.failed).toBe(2)
  })
})
