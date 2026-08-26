/**
 * The month boundary.
 *
 * Every case here is a boundary, because the middle of a month is not where
 * this breaks. December has to roll into January of the NEXT year; the first
 * instant of a month has to belong to that month rather than the previous one;
 * and a machine in Kolkata or Los Angeles has to compute the same window as a
 * machine in UTC, or two customers on the same plan get different allowances.
 */

import { describe, expect, it } from 'vitest'
import { periodEnd, periodStart, resetsOn } from '../lib/billing-period.ts'

const iso = (d: Date) => d.toISOString()

describe('periodStart', () => {
  it('returns the first instant of the month', () => {
    expect(iso(periodStart(new Date('2026-08-17T13:45:12.000Z')))).toBe('2026-08-01T00:00:00.000Z')
  })

  it('treats the first instant of a month as already inside it', () => {
    expect(iso(periodStart(new Date('2026-08-01T00:00:00.000Z')))).toBe('2026-08-01T00:00:00.000Z')
  })

  it('treats the last instant of a month as still inside it', () => {
    expect(iso(periodStart(new Date('2026-08-31T23:59:59.999Z')))).toBe('2026-08-01T00:00:00.000Z')
  })
})

describe('periodEnd', () => {
  it('returns the first instant of the next month', () => {
    expect(iso(periodEnd(new Date('2026-08-17T13:45:12.000Z')))).toBe('2026-09-01T00:00:00.000Z')
  })

  it('rolls December into January of the following year', () => {
    expect(iso(periodEnd(new Date('2026-12-31T23:59:59.999Z')))).toBe('2027-01-01T00:00:00.000Z')
  })

  it('handles February in a leap year without a special case', () => {
    expect(iso(periodEnd(new Date('2028-02-29T12:00:00.000Z')))).toBe('2028-03-01T00:00:00.000Z')
  })
})

describe('UTC, not the server’s time zone', () => {
  /**
   * 2026-09-01T02:00Z is still 31 August in Los Angeles and already 1 September
   * in Kolkata. The window must not depend on which of those the server is in.
   */
  it('puts an instant just after midnight UTC in the new month', () => {
    const justAfterMidnight = new Date('2026-09-01T02:00:00.000Z')
    expect(iso(periodStart(justAfterMidnight))).toBe('2026-09-01T00:00:00.000Z')
    expect(iso(periodEnd(justAfterMidnight))).toBe('2026-10-01T00:00:00.000Z')
  })

  it('puts an instant just before midnight UTC in the old month', () => {
    const justBefore = new Date('2026-08-31T22:00:00.000Z')
    expect(iso(periodStart(justBefore))).toBe('2026-08-01T00:00:00.000Z')
  })
})

describe('resetsOn', () => {
  it('names the day the allowance comes back', () => {
    expect(resetsOn(new Date('2026-08-17T13:45:12.000Z'))).toBe('1 September')
  })

  it('names January when the year rolls over', () => {
    expect(resetsOn(new Date('2026-12-05T00:00:00.000Z'))).toBe('1 January')
  })
})
