/**
 * Deep tests for DNS Checker — diffDnsRecords + checkDns (offline-safe).
 *
 * Covers:
 *   1. diffDnsRecords — set-based comparison (order-independent)
 *   2. diffDnsRecords — no change, only additions, only removals, both
 *   3. diffDnsRecords — type matters (A vs CNAME not interchangeable)
 *   4. diffDnsRecords — empty arrays
 *   5. diffDnsRecords — idempotent (same records = no diff)
 *   6. checkDns — SSRF / blocked hostname guard
 *   7. checkDns — regex rejection (invalid hostnames)
 *   8. Hostname validator edge cases (via blocked hostname path)
 *   9. DnsRecordSchema runtime validation
 *  10. withTimeout behavior via checkDns (blocked = immediate return)
 */

import { describe, expect, it } from 'vitest'
import {
  diffDnsRecords,
  checkDns,
  DnsRecordSchema,
  DnsRecordsSchema,
  DnsCheckResultSchema,
  DnsDiffResultSchema,
} from '@scanlyfix/db/dns-checker.ts'
import type { DnsRecord } from '@scanlyfix/db/dns-checker.ts'

// ─── diffDnsRecords ────────────────────────────────────────────────────────────

describe('diffDnsRecords — no change', () => {
  it('identical records → changed: false, added: [], removed: []', () => {
    const records: DnsRecord[] = [
      { type: 'A', value: '93.184.216.34' },
      { type: 'NS', value: 'ns1.example.com' },
    ]
    const diff = diffDnsRecords(records, records)
    expect(diff.changed).toBe(false)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
  })

  it('same records in different order → still no change (order-independent)', () => {
    const prev: DnsRecord[] = [
      { type: 'A', value: '1.1.1.1' },
      { type: 'A', value: '2.2.2.2' },
    ]
    const curr: DnsRecord[] = [
      { type: 'A', value: '2.2.2.2' },
      { type: 'A', value: '1.1.1.1' },
    ]
    const diff = diffDnsRecords(prev, curr)
    expect(diff.changed).toBe(false)
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
  })

  it('both empty → no change', () => {
    const diff = diffDnsRecords([], [])
    expect(diff.changed).toBe(false)
  })
})

describe('diffDnsRecords — additions only', () => {
  it('new A record added → added contains it, removed empty', () => {
    const prev: DnsRecord[] = [{ type: 'A', value: '1.1.1.1' }]
    const curr: DnsRecord[] = [
      { type: 'A', value: '1.1.1.1' },
      { type: 'A', value: '2.2.2.2' },  // new
    ]
    const diff = diffDnsRecords(prev, curr)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]).toEqual({ type: 'A', value: '2.2.2.2' })
    expect(diff.removed).toHaveLength(0)
  })

  it('first run (no previous) — everything is added', () => {
    const curr: DnsRecord[] = [
      { type: 'A', value: '1.2.3.4' },
      { type: 'NS', value: 'ns1.example.com' },
    ]
    const diff = diffDnsRecords([], curr)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(2)
    expect(diff.removed).toHaveLength(0)
  })
})

describe('diffDnsRecords — removals only', () => {
  it('A record removed → removed contains it, added empty', () => {
    const prev: DnsRecord[] = [
      { type: 'A', value: '1.1.1.1' },
      { type: 'A', value: '2.2.2.2' },
    ]
    const curr: DnsRecord[] = [{ type: 'A', value: '1.1.1.1' }]
    const diff = diffDnsRecords(prev, curr)
    expect(diff.changed).toBe(true)
    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0]).toEqual({ type: 'A', value: '2.2.2.2' })
    expect(diff.added).toHaveLength(0)
  })

  it('all records removed (site gone)', () => {
    const prev: DnsRecord[] = [{ type: 'A', value: '93.184.216.34' }]
    const diff = diffDnsRecords(prev, [])
    expect(diff.changed).toBe(true)
    expect(diff.removed).toHaveLength(1)
    expect(diff.added).toHaveLength(0)
  })
})

describe('diffDnsRecords — both added and removed (CDN migration)', () => {
  it('old IP removed, new IP added (CDN switch)', () => {
    const prev: DnsRecord[] = [
      { type: 'A', value: '93.184.216.34' },  // old IP
      { type: 'NS', value: 'ns1.example.com' },
    ]
    const curr: DnsRecord[] = [
      { type: 'A', value: '104.21.55.0' },    // new CDN IP
      { type: 'NS', value: 'ns1.example.com' },
    ]
    const diff = diffDnsRecords(prev, curr)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]!.value).toBe('104.21.55.0')
    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0]!.value).toBe('93.184.216.34')
  })

  it('NS server changed (registrar switch)', () => {
    const prev: DnsRecord[] = [
      { type: 'NS', value: 'ns1.godaddy.com' },
      { type: 'NS', value: 'ns2.godaddy.com' },
    ]
    const curr: DnsRecord[] = [
      { type: 'NS', value: 'ns1.cloudflare.com' },
      { type: 'NS', value: 'ns2.cloudflare.com' },
    ]
    const diff = diffDnsRecords(prev, curr)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(2)
    expect(diff.removed).toHaveLength(2)
  })
})

describe('diffDnsRecords — type discrimination', () => {
  it('same value but different type → treated as distinct records', () => {
    // "example.com" as A record vs NS record are NOT the same
    const prev: DnsRecord[] = [{ type: 'A', value: 'example.com' }]
    const curr: DnsRecord[] = [{ type: 'NS', value: 'example.com' }]
    const diff = diffDnsRecords(prev, curr)
    expect(diff.changed).toBe(true)
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]!.type).toBe('NS')
    expect(diff.removed).toHaveLength(1)
    expect(diff.removed[0]!.type).toBe('A')
  })

  it('CNAME added does not affect A records', () => {
    const prev: DnsRecord[] = [{ type: 'A', value: '1.2.3.4' }]
    const curr: DnsRecord[] = [
      { type: 'A', value: '1.2.3.4' },
      { type: 'CNAME', value: 'www.example.com' },
    ]
    const diff = diffDnsRecords(prev, curr)
    expect(diff.changed).toBe(true)
    expect(diff.added[0]!.type).toBe('CNAME')
    expect(diff.removed).toHaveLength(0)
  })
})

// ─── checkDns — Offline-safe tests (SSRF / validation path) ──────────────────

describe('checkDns — SSRF and hostname validation (no network)', () => {
  it('rejects localhost', async () => {
    const r = await checkDns('localhost')
    expect(r.ok).toBe(false)
    expect(r.records).toHaveLength(0)
    expect(r.error).toContain('localhost')
  })

  it('rejects 127.0.0.1', async () => {
    const r = await checkDns('127.0.0.1')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('127.0.0.1')
  })

  it('rejects 0.0.0.0', async () => {
    const r = await checkDns('0.0.0.0')
    expect(r.ok).toBe(false)
  })

  it('rejects .local TLD (mDNS leak)', async () => {
    const r = await checkDns('myserver.local')
    expect(r.ok).toBe(false)
  })

  it('rejects .internal TLD', async () => {
    const r = await checkDns('service.internal')
    expect(r.ok).toBe(false)
  })

  it('rejects .corp TLD', async () => {
    const r = await checkDns('intranet.corp')
    expect(r.ok).toBe(false)
  })

  it('rejects .lan TLD', async () => {
    const r = await checkDns('printer.lan')
    expect(r.ok).toBe(false)
  })

  it('rejects .home TLD', async () => {
    const r = await checkDns('router.home')
    expect(r.ok).toBe(false)
  })

  it('rejects empty string', async () => {
    const r = await checkDns('')
    expect(r.ok).toBe(false)
  })

  it('rejects hostname with spaces', async () => {
    const r = await checkDns('invalid hostname')
    expect(r.ok).toBe(false)
  })

  it('rejects hostname starting with hyphen', async () => {
    const r = await checkDns('-example.com')
    expect(r.ok).toBe(false)
  })

  it('rejects single-label hostname (no TLD)', async () => {
    const r = await checkDns('example')
    expect(r.ok).toBe(false)
  })

  it('rejects hostname with path component', async () => {
    // URL should be parsed to hostname before calling checkDns
    const r = await checkDns('example.com/path')
    expect(r.ok).toBe(false)
  })
})

// ─── Zod Schema Validation ────────────────────────────────────────────────────

describe('DnsRecord Zod schema runtime validation', () => {
  it('valid A record', () => {
    const r = DnsRecordSchema.safeParse({ type: 'A', value: '1.2.3.4' })
    expect(r.success).toBe(true)
  })

  it('valid CNAME record', () => {
    const r = DnsRecordSchema.safeParse({ type: 'CNAME', value: 'www.example.com' })
    expect(r.success).toBe(true)
  })

  it('valid NS record', () => {
    const r = DnsRecordSchema.safeParse({ type: 'NS', value: 'ns1.example.com' })
    expect(r.success).toBe(true)
  })

  it('rejects unknown record type MX', () => {
    const r = DnsRecordSchema.safeParse({ type: 'MX', value: 'mail.example.com' })
    expect(r.success).toBe(false)
  })

  it('rejects TXT type (not in our schema)', () => {
    const r = DnsRecordSchema.safeParse({ type: 'TXT', value: 'v=spf1' })
    expect(r.success).toBe(false)
  })

  it('rejects empty value', () => {
    const r = DnsRecordSchema.safeParse({ type: 'A', value: '' })
    expect(r.success).toBe(false)
  })

  it('rejects value over 253 chars', () => {
    const r = DnsRecordSchema.safeParse({ type: 'NS', value: 'a'.repeat(254) })
    expect(r.success).toBe(false)
  })

  it('DnsRecordsSchema allows empty array', () => {
    expect(DnsRecordsSchema.safeParse([]).success).toBe(true)
  })

  it('DnsRecordsSchema rejects array of 101 records (max 100)', () => {
    const records = Array.from({ length: 101 }, (_, i) => ({ type: 'A', value: `1.1.1.${i % 256}` }))
    const r = DnsRecordsSchema.safeParse(records)
    expect(r.success).toBe(false)
  })
})

describe('DnsDiffResult schema', () => {
  it('valid diff result passes', () => {
    const r = DnsDiffResultSchema.safeParse({
      changed: true,
      added: [{ type: 'A', value: '1.2.3.4' }],
      removed: [],
    })
    expect(r.success).toBe(true)
  })

  it('no-change result passes', () => {
    const r = DnsDiffResultSchema.safeParse({ changed: false, added: [], removed: [] })
    expect(r.success).toBe(true)
  })
})

describe('DnsCheckResult schema', () => {
  it('ok result with records passes', () => {
    const r = DnsCheckResultSchema.safeParse({
      ok: true,
      records: [{ type: 'A', value: '93.184.216.34' }],
      error: null,
    })
    expect(r.success).toBe(true)
  })

  it('error result with empty records passes', () => {
    const r = DnsCheckResultSchema.safeParse({
      ok: false,
      records: [],
      error: 'Lookup timed out',
    })
    expect(r.success).toBe(true)
  })
})

// ─── Live DNS test (skipped in offline/CI, run with SCANLYFIX_LIVE=1) ─────────

describe('checkDns — live DNS lookup', () => {
  it.runIf(!!process.env.SCANLYFIX_LIVE)(
    'resolves example.com to real A records',
    async () => {
      const r = await checkDns('example.com')
      expect(r.ok).toBe(true)
      expect(r.records.length).toBeGreaterThan(0)
      const aRecords = r.records.filter((rec) => rec.type === 'A')
      expect(aRecords.length).toBeGreaterThan(0)
      expect(r.error).toBeNull()
    },
    15_000,
  )
})
