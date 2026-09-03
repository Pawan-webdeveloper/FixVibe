/**
 * DNS checker and drift detection tests.
 *
 * Tests the core DNS lookup, hostname validation, and diff logic.
 * The DB integration tests (snapshot storage) are in monitors.test.ts.
 */

import { describe, expect, it } from 'vitest'
import { checkDns, diffDnsRecords, type DnsRecord } from '../src/dns-checker.ts'

describe('checkDns', () => {
  it('rejects localhost', async () => {
    const result = await checkDns('localhost')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Blocked hostname')
  })

  it('rejects private IPs', async () => {
    const result = await checkDns('127.0.0.1')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Blocked hostname')
  })

  it('rejects internal TLDs', async () => {
    const result = await checkDns('server.local')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Blocked hostname')
  })

  it('rejects invalid hostname format', async () => {
    const result = await checkDns('not a hostname')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Blocked hostname')
  })

  it.runIf(!!process.env.SCANLYFIX_LIVE)('resolves A records for a valid domain (live, requires network)', async () => {
    // example.com is a well-known domain that should always resolve
    const result = await checkDns('example.com')
    expect(result.ok).toBe(true)
    expect(result.records.length).toBeGreaterThan(0)
    expect(result.records.some((r) => r.type === 'A')).toBe(true)
  })
})

describe('diffDnsRecords', () => {
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

  it('detects added records', () => {
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

  it('detects removed records', () => {
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

  it('detects both added and removed records', () => {
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

  it('is order-independent', () => {
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

  it('handles empty records', () => {
    const diff = diffDnsRecords([], [])
    expect(diff.changed).toBe(false)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
  })

  it('handles transition from empty to populated', () => {
    const current: DnsRecord[] = [{ type: 'A', value: '93.184.216.34' }]
    const diff = diffDnsRecords([], current)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(1)
    expect(diff.removed).toHaveLength(0)
  })

  it('handles transition from populated to empty', () => {
    const previous: DnsRecord[] = [{ type: 'A', value: '93.184.216.34' }]
    const diff = diffDnsRecords(previous, [])
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(1)
  })
})
