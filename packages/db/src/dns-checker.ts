/**
 * dns-checker.ts
 *
 * DNS records fetch karta hai aur previous snapshot se compare karta hai.
 *
 * Security:
 *  - Hostname validate karta hai (SSRF prevention)
 *  - Private/internal IPs block karta hai
 *  - Har DNS lookup mein timeout lagata hai (DoS prevention)
 *
 * Type Safety:
 *  - Zod schemas se runtime validation
 *  - Sab types Zod se infer hote hain (no duplication)
 */

import { resolve4, resolveCname, resolveNs } from 'node:dns/promises'
import { z } from 'zod'

// ─── Zod Schemas ──────────────────────────────────────────────────────────────
// WHY Zod: Runtime validation + TypeScript types ek jagah se — no manual interface

export const DnsRecordTypeSchema = z.enum(['A', 'CNAME', 'NS'])

export const DnsRecordSchema = z.object({
  type: DnsRecordTypeSchema,
  value: z.string().min(1).max(253), // max valid DNS name length
})

export const DnsRecordsSchema = z.array(DnsRecordSchema).max(100)
// WHY max 100: Prevent memory bloat from unusually large DNS responses

export const DnsCheckResultSchema = z.object({
  ok: z.boolean(),
  records: DnsRecordsSchema,
  error: z.string().nullable(),
})

export const DnsDiffResultSchema = z.object({
  changed: z.boolean(),
  added: DnsRecordsSchema,
  removed: DnsRecordsSchema,
})

// ─── Inferred Types (single source of truth) ──────────────────────────────────
export type DnsRecord = z.infer<typeof DnsRecordSchema>
export type DnsCheckResult = z.infer<typeof DnsCheckResultSchema>
export type DnsDiffResult = z.infer<typeof DnsDiffResultSchema>

// ─── Constants ────────────────────────────────────────────────────────────────
const DNS_TIMEOUT_MS = 5_000 // 5 seconds per lookup

// Valid public hostname regex (RFC 1123 compliant)
const HOSTNAME_REGEX =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/

// Internal hostnames / TLDs to block (SSRF prevention)
const BLOCKED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])
const BLOCKED_TLDS = ['.local', '.internal', '.corp', '.home', '.lan']

// ─── Hostname Validator ────────────────────────────────────────────────────────
// WHY: Prevent attackers from passing internal hostnames like "localhost" or
//      "169.254.169.254" (AWS metadata) to probe internal infrastructure
function isValidPublicHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase()

  if (!HOSTNAME_REGEX.test(hostname)) return false
  if (BLOCKED_HOSTNAMES.has(lower)) return false
  if (BLOCKED_TLDS.some((tld) => lower.endsWith(tld))) return false

  return true
}


// ─── Timeout Wrapper ──────────────────────────────────────────────────────────
// WHY: node:dns/promises DNS lookup abort signal support nahi karta,
//      isliye Promise.race se manually timeout enforce karte hain
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    ),
  )
  return Promise.race([promise, timeout])
}


// ─── Apex Domain Extractor ────────────────────────────────────────────────────
// WHY: NS records apex domain pe hote hain, subdomain pe nahi
// e.g. "api.example.com" → "example.com"
function extractApexDomain(hostname: string): string {
  const parts = hostname.split('.')
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname
}


// ─── Main Checker ─────────────────────────────────────────────────────────────
export async function checkDns(hostname: string): Promise<DnsCheckResult> {
  // Security check first
  if (!isValidPublicHostname(hostname)) {
    return {
      ok: false,
      records: [],
      error: `Blocked hostname: ${hostname}`,
    }
  }

  const records: DnsRecord[] = []

  try {
    // 1. A Records (required — fail if missing)
    const aRecords = await withTimeout(
      resolve4(hostname),
      DNS_TIMEOUT_MS,
      `A record lookup for ${hostname}`,
    )
    for (const ip of aRecords) {
      records.push({ type: 'A', value: ip })
    }

    // 2. CNAME Records (optional — apex domains don't have these)
    try {
      const cnameRecords = await withTimeout(
        resolveCname(hostname),
        DNS_TIMEOUT_MS,
        `CNAME lookup for ${hostname}`,
      )
      for (const cname of cnameRecords) {
        records.push({ type: 'CNAME', value: cname })
      }
    } catch {
      // CNAME nahi hai toh koi issue nahi — silently skip
    }

    // 3. NS Records (from apex domain, optional)
    const apex = extractApexDomain(hostname)
    try {
      const nsRecords = await withTimeout(
        resolveNs(apex),
        DNS_TIMEOUT_MS,
        `NS lookup for ${apex}`,
      )
      for (const ns of nsRecords) {
        records.push({ type: 'NS', value: ns })
      }
    } catch {
      // NS failure is non-fatal — silently skip
    }

    // Validate output before returning (runtime safety)
    const parsed = DnsRecordsSchema.safeParse(records)
    if (!parsed.success) {
      return {
        ok: false,
        records: [],
        error: 'DNS response validation failed: ' + parsed.error.message,
      }
    }

    return { ok: true, records: parsed.data, error: null }
  } catch (err) {
    return {
      ok: false,
      records: [],
      error: err instanceof Error ? err.message : 'DNS lookup failed',
    }
  }
}

// ─── Diff Function ────────────────────────────────────────────────────────────
// WHY: Set-based comparison — O(n) time, order-independent
export function diffDnsRecords(
  previous: DnsRecord[],
  current: DnsRecord[],
): DnsDiffResult {
  const toKey = (r: DnsRecord): string => `${r.type}:${r.value}`

  const prevKeys = new Set(previous.map(toKey))
  const currKeys = new Set(current.map(toKey))

  const added = current.filter((r) => !prevKeys.has(toKey(r)))
  const removed = previous.filter((r) => !currKeys.has(toKey(r)))

  return {
    changed: added.length > 0 || removed.length > 0,
    added,
    removed,
  }
}