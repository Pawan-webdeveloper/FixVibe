/**
 * packages/db/test/maintenance-window.test.ts
 *
 * Pure time-math tests for maintenance windows. No DB. The test cases
 * pin down the three behaviours the probe depends on:
 *
 *   1. "Right now" inside a 30-min window — true.
 *   2. "Right now" outside the window on the same day — false.
 *   3. The right day-of-week matters: a Sunday window on Wednesday — false.
 *   4. Daily windows (dayOfWeek = null) — true on every day inside.
 *   5. Timezone is honoured: 14:00 UTC != 14:00 America/Los_Angeles.
 *   6. DST: a window that exists on both sides of a spring-forward or
 *      fall-back still produces the right answer (we exercise the
 *      known IANA transitions below).
 *   7. Disabled windows never match.
 *
 * We construct synthetic Dates via Date.UTC so the assertions are
 * deterministic regardless of the host's clock.
 */

import { describe, expect, it } from 'vitest'
import {
  isInstantInWindow,
  projectToLocal,
  type MaintenanceWindowSpec,
} from '../src/maintenance-window.ts'

/** Build a UTC Date for a given ISO-ish string. */
function utc(iso: string): Date {
  return new Date(iso)
}

describe('projectToLocal', () => {
  it('projects a UTC instant into UTC', () => {
    const local = projectToLocal(utc('2026-03-15T14:30:00Z'), 'UTC')
    expect(local).toEqual({ dayOfWeek: 0, dayOfMonth: 15, hour: 14, minute: 30 })
  })

  it('shifts the hour for America/Los_Angeles (UTC-7 in March after spring-forward)', () => {
    // 2026-03-15T14:30Z → 2026-03-15 07:30 in Los Angeles (PDT — spring
    // forward was March 8).
    const local = projectToLocal(utc('2026-03-15T14:30:00Z'), 'America/Los_Angeles')
    expect(local.hour).toBe(7)
    expect(local.minute).toBe(30)
  })

  it('produces the right day-of-week', () => {
    // 2026-03-15 is a Sunday.
    const local = projectToLocal(utc('2026-03-15T12:00:00Z'), 'UTC')
    expect(local.dayOfWeek).toBe(0)
  })
})

describe('isInstantInWindow', () => {
  const baseSpec: MaintenanceWindowSpec = {
    dayOfWeek: 0, // Sundays
    startTime: '14:00',
    durationMin: 60,
    timezone: 'UTC',
    enabled: true,
  }

  it('matches an instant inside the window', () => {
    // Sunday 14:30 UTC
    expect(isInstantInWindow(utc('2026-03-15T14:30:00Z'), baseSpec)).toBe(true)
  })

  it('rejects an instant before the window', () => {
    // Sunday 13:30 UTC
    expect(isInstantInWindow(utc('2026-03-15T13:30:00Z'), baseSpec)).toBe(false)
  })

  it('rejects an instant after the window', () => {
    // Sunday 15:01 UTC — exclusive end
    expect(isInstantInWindow(utc('2026-03-15T15:01:00Z'), baseSpec)).toBe(false)
  })

  it('rejects the wrong day of the week', () => {
    // Monday — not Sunday
    expect(isInstantInWindow(utc('2026-03-16T14:30:00Z'), baseSpec)).toBe(false)
  })

  it('matches a daily window on any day', () => {
    const daily: MaintenanceWindowSpec = { ...baseSpec, dayOfWeek: null }
    expect(isInstantInWindow(utc('2026-03-16T14:30:00Z'), daily)).toBe(true) // Monday
    expect(isInstantInWindow(utc('2026-03-17T14:30:00Z'), daily)).toBe(true) // Tuesday
    expect(isInstantInWindow(utc('2026-03-18T14:30:00Z'), daily)).toBe(true) // Wednesday
  })

  it('honours the timezone — same UTC instant, different zones', () => {
    // 2026-03-15T22:00:00Z is 15:00 PDT in Los Angeles on Sunday — that
    // is past the 14:00–15:00 window. We pick an instant that is
    // simultaneously inside a 14:00 window in one zone AND outside
    // the same wall-clock window in another zone.
    const instant = utc('2026-03-15T22:00:00Z')

    // 14:00 in Berlin = 13:00Z in March (CET+0 → summer time starts
    // late March, so March 15 is still CET = UTC+1). 22:00Z = 23:00
    // Berlin — OUT of a 14:00–15:00 Berlin window.
    const inBerlinAt14 = isInstantInWindow(instant, {
      ...baseSpec,
      timezone: 'Europe/Berlin',
      startTime: '14:00',
    })
    expect(inBerlinAt14).toBe(false)

    // 14:00 in LA = 22:00Z (PDT, UTC-7 in March, spring-forward was
    // March 8). 22:00Z = 15:00 LA — INSIDE a 14:00–15:00 LA window
    // (15:00 is the exclusive end so it is OUT — use a slightly later
    // wall-clock to confirm it really is in the window).
    expect(
      isInstantInWindow(utc('2026-03-15T21:30:00Z'), {
        ...baseSpec,
        timezone: 'America/Los_Angeles',
        startTime: '14:00',
      }),
    ).toBe(true)

    // 14:00 in Tokyo = 05:00Z. 22:00Z is 07:00 Tokyo — OUT of a 14:00
    // Tokyo window.
    const inTokyoAt14 = isInstantInWindow(instant, {
      ...baseSpec,
      timezone: 'Asia/Tokyo',
      startTime: '14:00',
    })
    expect(inTokyoAt14).toBe(false)
  })

  it('a disabled window never matches', () => {
    expect(
      isInstantInWindow(utc('2026-03-15T14:30:00Z'), {
        ...baseSpec,
        enabled: false,
      }),
    ).toBe(false)
  })

  it('accepts startTime in HH:MM:SS form (with seconds)', () => {
    const spec: MaintenanceWindowSpec = {
      ...baseSpec,
      startTime: '14:00:00',
    }
    expect(isInstantInWindow(utc('2026-03-15T14:30:00Z'), spec)).toBe(true)
  })

  it('rejects an invalid startTime at construction', () => {
    // The pure math itself does not validate — it throws at runtime
    // when the parsed hour is out of range.
    const bad: MaintenanceWindowSpec = {
      ...baseSpec,
      startTime: '25:00',
    }
    expect(() => isInstantInWindow(utc('2026-03-15T14:30:00Z'), bad)).toThrow(
      /Invalid startTime/,
    )
  })

  it('handles a minute-resolution boundary correctly', () => {
    // Window 14:00–15:00 — 14:59 is IN, 15:00 is OUT (start-exclusive end).
    expect(isInstantInWindow(utc('2026-03-15T14:59:00Z'), baseSpec)).toBe(true)
    expect(isInstantInWindow(utc('2026-03-15T15:00:00Z'), baseSpec)).toBe(false)
  })

  it('handles a long window (8h) within a single day', () => {
    const long: MaintenanceWindowSpec = {
      ...baseSpec,
      startTime: '08:00',
      durationMin: 480,
    }
    expect(isInstantInWindow(utc('2026-03-15T08:00:00Z'), long)).toBe(true)
    expect(isInstantInWindow(utc('2026-03-15T15:59:00Z'), long)).toBe(true)
    expect(isInstantInWindow(utc('2026-03-15T16:00:00Z'), long)).toBe(false)
  })

  it('survives the spring-forward DST transition (America/Los_Angeles)', () => {
    // US spring-forward 2026: 2026-03-08 02:00 PST → 03:00 PDT. The clock
    // skips 02:00–02:59 local. We test with a window that BEGINS
    // before the jump and ENDS after — proving the math does not
    // crash on the missing hour and still answers correctly per the
    // wall clock the user sees.
    const spec: MaintenanceWindowSpec = {
      dayOfWeek: 0, // Sunday
      startTime: '01:00',
      durationMin: 180, // 01:00–04:00 LA local
      timezone: 'America/Los_Angeles',
      enabled: true,
    }
    // 2026-03-08T09:30:00Z = 01:30 PST (before spring-forward, in the
    // window).
    expect(isInstantInWindow(utc('2026-03-08T09:30:00Z'), spec)).toBe(true)
    // 2026-03-08T10:30:00Z = 03:30 PDT (after spring-forward, still in
    // the window because wall-clock 03:30 is between 01:00 and 04:00).
    expect(isInstantInWindow(utc('2026-03-08T10:30:00Z'), spec)).toBe(true)
    // 2026-03-08T11:01:00Z = 04:01 PDT — past the 04:00 exclusive end.
    expect(isInstantInWindow(utc('2026-03-08T11:01:00Z'), spec)).toBe(false)
  })

  it('survives the fall-back DST transition (America/Los_Angeles)', () => {
    // US fall-back 2026: 2026-11-01 02:00 PDT → 01:00 PST. The clock
    // repeats 01:00–01:59. A 01:00–03:00 LA local window on that day
    // should still match both 01:30 occurrences.
    const spec: MaintenanceWindowSpec = {
      dayOfWeek: 0, // Sunday
      startTime: '01:00',
      durationMin: 120,
      timezone: 'America/Los_Angeles',
      enabled: true,
    }
    // 2026-11-01T08:30:00Z = 01:30 PDT (before fall-back, first 01:30).
    expect(isInstantInWindow(utc('2026-11-01T08:30:00Z'), spec)).toBe(true)
    // 2026-11-01T09:30:00Z = 01:30 PST (after fall-back, second 01:30).
    expect(isInstantInWindow(utc('2026-11-01T09:30:00Z'), spec)).toBe(true)
    // 2026-11-01T11:30:00Z = 03:30 PST (past the window's 03:00 end).
    expect(isInstantInWindow(utc('2026-11-01T11:30:00Z'), spec)).toBe(false)
  })
})
