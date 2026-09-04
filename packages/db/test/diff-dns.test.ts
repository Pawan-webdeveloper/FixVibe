/**
 * Characterization tests for diffDnsRecords()
 *
 * Purpose: Capture CURRENT behavior as a safety net before refactoring.
 * This is a pure function — no DB, no network, fully deterministic.
 *
 * Coverage:
 *   - No change (identical records)
 *   - Added records
 *   - Removed records
 *   - Both added and removed
 *   - Order independence
 *   - Empty arrays
 *   - First baseline (empty → populated)
 *   - All records removed (populated → empty)
 *   - Duplicate records
 *   - Mixed record types
 */

import { describe, expect, it } from 'vitest'
import { diffDnsRecords, type DnsRecord } from '../src/dns-checker.ts'

// ─── No change scenarios ──────────────────────────────────────────────────────

describe('diffDnsRecords — no change', () => {
  it('detects no change when records are identical', () => {
    const records: DnsRecord[] = [
      { type: 'A', value: '93.184.216.34' },
      { type: 'NS', value: 'a.iana-servers.net' },
    ]
    const diff = diffDnsRecords(records, records)
    expect(diff.changed).toBe(false)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
  })

  it('detects no change with different order', () => {
    const previous: DnsRecord[] = [
      { type: 'A', value: '1.1.1.1' },
      { type: 'A', value: '2.2.2.2' },
    ]
    const current: DnsRecord[] = [
      { type: 'A', value: '2.2.2.2' },
      { type: 'A', value: '1.1.1.1' },
    ]
    const diff = diffDnsRecords(previous, current)
    expect(diff.changed).toBe(false)
  })

  it('detects no change with empty arrays', () => {
    const diff = diffDnsRecords([], [])
    expect(diff.changed).toBe(false)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
  })
})

// ─── Added records ────────────────────────────────────────────────────────────

describe('diffDnsRecords — added records', () => {
  it('detects a single added A record', () => {
    const previous: DnsRecord[] = [{ type: 'A', value: '93.184.216.34' }]
    const current: DnsRecord[] = [
      { type: 'A', value: '93.184.216.34' },
      { type: 'A', value: '93.184.216.35' },
    ]
    const diff = diffDnsRecords(previous, current)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]).toEqual({ type: 'A', value: '93.184.216.35' })
    expect(diff.removed).toHaveLength(0)
  })

  it('detects multiple added records', () => {
    const previous: DnsRecord[] = [{ type: 'A', value: '1.1.1.1' }]
    const current: DnsRecord[] = [
      { type: 'A', value: '1.1.1.1' },
      { type: 'A', value: '2.2.2.2' },
      { type: 'A', value: '3.3.3.3' },
    ]
    const diff = diffDnsRecords(previous, current)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(2)
  })

  it('detects added CNAME record', () => {
    const previous: DnsRecord[] = [{ type: 'A', value: '1.1.1.1' }]
    const current: DnsRecord[] = [
      { type: 'A', value: '1.1.1.1' },
      { type: 'CNAME', value: 'cdn.example.com' },
    ]
    const diff = diffDnsRecords(previous, current)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]).toEqual({ type: 'CNAME', value: 'cdn.example.com' })
  })
})

// ─── Removed records ──────────────────────────────────────────────────────────

describe('diffDnsRecords — removed records', () => {
  it('detects a single removed record', () => {
    const previous: DnsRecord[] = [
      { type: 'A', value: '93.184.216.34' },
      { type: 'A', value: '93.184.216.35' },
    ]
    const current: DnsRecord[] = [{ type: 'A', value: '93.184.216.34' }]
    const diff = diffDnsRecords(previous, current)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0]).toEqual({ type: 'A', value: '93.184.216.35' })
  })

  it('detects multiple removed records', () => {
    const previous: DnsRecord[] = [
      { type: 'A', value: '1.1.1.1' },
      { type: 'A', value: '2.2.2.2' },
      { type: 'A', value: '3.3.3.3' },
    ]
    const current: DnsRecord[] = [{ type: 'A', value: '1.1.1.1' }]
    const diff = diffDnsRecords(previous, current)
    expect(diff.changed).toBe(true)
    expect(diff.removed).toHaveLength(2)
  })
})

// ─── Both added and removed ───────────────────────────────────────────────────

describe('diffDnsRecords — both added and removed', () => {
  it('detects simultaneous add and remove (CDN migration)', () => {
    const previous: DnsRecord[] = [
      { type: 'A', value: '93.184.216.34' },
      { type: 'CNAME', value: 'old.cdn.example.com' },
    ]
    const current: DnsRecord[] = [
      { type: 'A', value: '93.184.216.34' },
      { type: 'CNAME', value: 'new.cdn.example.com' },
    ]
    const diff = diffDnsRecords(previous, current)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]).toEqual({ type: 'CNAME', value: 'new.cdn.example.com' })
    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0]).toEqual({ type: 'CNAME', value: 'old.cdn.example.com' })
  })

  it('detects complete record replacement', () => {
    const previous: DnsRecord[] = [{ type: 'A', value: '1.1.1.1' }]
    const current: DnsRecord[] = [{ type: 'A', value: '2.2.2.2' }]
    const diff = diffDnsRecords(previous, current)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(1)
    expect(diff.removed).toHaveLength(1)
  })
})

// ─── First baseline (empty → populated) ───────────────────────────────────────

describe('diffDnsRecords — first baseline', () => {
  it('detects all records as added from empty baseline', () => {
    const current: DnsRecord[] = [
      { type: 'A', value: '93.184.216.34' },
      { type: 'NS', value: 'a.iana-servers.net' },
    ]
    const diff = diffDnsRecords([], current)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(2)
    expect(diff.removed).toHaveLength(0)
  })

  it('detects single record as added from empty', () => {
    const current: DnsRecord[] = [{ type: 'A', value: '1.1.1.1' }]
    const diff = diffDnsRecords([], current)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(1)
  })
})

// ─── All records removed (populated → empty) ──────────────────────────────────

describe('diffDnsRecords — all records removed', () => {
  it('detects all records as removed when current is empty', () => {
    const previous: DnsRecord[] = [
      { type: 'A', value: '93.184.216.34' },
      { type: 'NS', value: 'a.iana-servers.net' },
    ]
    const diff = diffDnsRecords(previous, [])
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(2)
  })
})

// ─── Mixed record types ───────────────────────────────────────────────────────

describe('diffDnsRecords — mixed record types', () => {
  it('handles A, CNAME, and NS records together', () => {
    const previous: DnsRecord[] = [
      { type: 'A', value: '1.1.1.1' },
      { type: 'CNAME', value: 'old.example.com' },
      { type: 'NS', value: 'ns1.example.com' },
    ]
    const current: DnsRecord[] = [
      { type: 'A', value: '1.1.1.1' },
      { type: 'CNAME', value: 'new.example.com' },
      { type: 'NS', value: 'ns1.example.com' },
      { type: 'NS', value: 'ns2.example.com' },
    ]
    const diff = diffDnsRecords(previous, current)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(2) // new CNAME + new NS
    expect(diff.removed).toHaveLength(1) // old CNAME
  })

  it('treats same value with different types as different records', () => {
    const previous: DnsRecord[] = [{ type: 'A', value: '1.1.1.1' }]
    const current: DnsRecord[] = [{ type: 'CNAME', value: '1.1.1.1' }]
    const diff = diffDnsRecords(previous, current)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(1)
    expect(diff.removed).toHaveLength(1)
  })
})

// ─── Duplicate records ────────────────────────────────────────────────────────

describe('diffDnsRecords — duplicate records', () => {
  it('handles duplicate records in previous', () => {
    const previous: DnsRecord[] = [
      { type: 'A', value: '1.1.1.1' },
      { type: 'A', value: '1.1.1.1' },
    ]
    const current: DnsRecord[] = [{ type: 'A', value: '1.1.1.1' }]
    const diff = diffDnsRecords(previous, current)
    // Set-based comparison deduplicates
    expect(diff.changed).toBe(false)
  })

  it('handles duplicate records in current', () => {
    const previous: DnsRecord[] = [{ type: 'A', value: '1.1.1.1' }]
    const current: DnsRecord[] = [
      { type: 'A', value: '1.1.1.1' },
      { type: 'A', value: '1.1.1.1' },
    ]
    const diff = diffDnsRecords(previous, current)
    expect(diff.changed).toBe(false)
  })
})

// ─── Type discrimination ──────────────────────────────────────────────────────

describe('diffDnsRecords — type discrimination', () => {
  it('treats A and CNAME with same value as different records', () => {
    const previous: DnsRecord[] = [{ type: 'A', value: 'example.com' }]
    const current: DnsRecord[] = [{ type: 'CNAME', value: 'example.com' }]
    const diff = diffDnsRecords(previous, current)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(1)
    expect(diff.removed).toHaveLength(1)
  })

  it('does not confuse NS records with A records', () => {
    const previous: DnsRecord[] = [{ type: 'NS', value: 'ns1.example.com' }]
    const current: DnsRecord[] = [{ type: 'A', value: 'ns1.example.com' }]
    const diff = diffDnsRecords(previous, current)
    expect(diff.changed).toBe(true)
  })
})
