/**
 * DNS context: TXT / CAA / MX for the scanned hostname. Consumed by the
 * SPF/DKIM/DMARC and CAA checks (Phase 1); gathered here because context is
 * built in one pass.
 *
 * Notes for the next reader:
 *  - Every resolver call degrades to [] — NXDOMAIN, timeouts and missing record
 *    types are normal life for DNS, not scan failures.
 *  - Records are resolved for the page hostname as-is. Apex derivation for
 *    "www." subdomains (where SPF actually lives) needs the Public Suffix List
 *    and arrives with the email checks in Phase 1.
 *  - `dnssec` is hard-coded false: Node's resolver cannot surface the AD bit.
 *    Real validation needs a DoH query (Phase 1); reporting false keeps us
 *    honest instead of guessing.
 */

import { isIP } from 'node:net'
import { resolveTxt, resolveCaa, resolveMx } from 'node:dns/promises'
import type { CheckContext } from '../types.ts'
import { unbracket } from './ssrf-guard.ts'

const EMPTY: CheckContext['dns'] = { txt: [], caa: [], mx: [], dnssec: false }

export async function getDnsInfo(hostname: string): Promise<CheckContext['dns']> {
  const host = unbracket(hostname)
  if (isIP(host)) return EMPTY // IP literals have no zone to query

  const [txt, caa, mx] = await Promise.all([
    resolveTxt(host).then(
      // TXT values arrive chunked in 255-byte pieces; join them back into one string.
      (records) => records.map((chunks) => chunks.join('')),
      () => [],
    ),
    resolveCaa(host).then(
      (records) =>
        records.map((record) => {
          if (record.issue) return `issue "${record.issue}"`
          if (record.issuewild) return `issuewild "${record.issuewild}"`
          if (record.iodef) return `iodef "${record.iodef}"`
          return JSON.stringify(record)
        }),
      () => [],
    ),
    resolveMx(host).then(
      (records) => [...records].sort((a, b) => a.priority - b.priority).map((r) => r.exchange),
      () => [],
    ),
  ])

  return { txt, caa, mx, dnssec: false }
}
