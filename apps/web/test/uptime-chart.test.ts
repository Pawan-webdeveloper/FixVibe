/**
 * Grouping uptime events into days.
 *
 * Pure, and the only part of the status page worth testing without a browser —
 * a strip that renders the wrong day is a status page that lies during exactly
 * the incident it was linked for.
 */

import { describe, expect, it } from 'vitest'
import { toDays } from '../components/monitors/uptime-days.ts'

const at = (iso: string, ok: boolean) => ({ ts: new Date(iso), ok })

describe('toDays', () => {
  it('groups by UTC day so the strip reads the same everywhere', () => {
    // Two events either side of local midnight in most zones, one UTC day.
    const days = toDays([at('2026-08-24T01:00:00Z', true), at('2026-08-24T23:00:00Z', true)])
    expect(days).toEqual([{ date: '2026-08-24', ok: 2, failed: 0 }])
  })

  it('counts successes and failures separately within a day', () => {
    const days = toDays([
      at('2026-08-24T01:00:00Z', true),
      at('2026-08-24T02:00:00Z', false),
      at('2026-08-24T03:00:00Z', false),
    ])
    expect(days[0]).toEqual({ date: '2026-08-24', ok: 1, failed: 2 })
  })

  it('returns days oldest-first, whatever order the events arrive in', () => {
    // The query hands them back newest-first; the strip reads left to right.
    const days = toDays([at('2026-08-24T00:00:00Z', true), at('2026-08-22T00:00:00Z', true)])
    expect(days.map((d) => d.date)).toEqual(['2026-08-22', '2026-08-24'])
  })

  it('keeps only the most recent window', () => {
    const events = Array.from({ length: 120 }, (_, i) =>
      at(new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), true),
    )
    const days = toDays(events, 90)
    expect(days).toHaveLength(90)
    expect(days.at(-1)?.date).toBe('2026-04-30')
  })

  it('accepts a serialized timestamp, which is what an API returns', () => {
    expect(toDays([{ ts: '2026-08-24T10:00:00.000Z', ok: true }])[0]?.date).toBe('2026-08-24')
  })

  it('handles a monitor with no events yet', () => {
    expect(toDays([])).toEqual([])
  })
})
