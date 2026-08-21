/**
 * DNS context: TXT / CAA / MX for the scanned hostname, plus the two lookups
 * the email checks need, which live on names the page hostname never reveals —
 * SPF on the organizational domain, DMARC on `_dmarc.<organizational domain>`.
 *
 * Notes for the next reader:
 *  - Every resolver call degrades to [] — NXDOMAIN, timeouts and missing record
 *    types are normal life for DNS, not scan failures.
 *  - `emailDomain` is null whenever the organizational domain cannot be derived
 *    without a Public Suffix List (see public-suffix.ts). Null propagates as
 *    empty record lists, and the email checks stay silent on it: reporting
 *    "no DMARC record" for a name we never queried would be a lie.
 *  - `dnssec` is hard-coded false: Node's resolver cannot surface the AD bit.
 *    Real validation needs a DoH query (Phase 3); reporting false keeps us
 *    honest instead of guessing.
 */

import { isIP } from 'node:net'
import { resolveTxt, resolveCaa, resolveMx } from 'node:dns/promises'
import type { CheckContext } from '../types.ts'
import { unbracket } from './ssrf-guard.ts'
import { organizationalDomain } from './public-suffix.ts'

const EMPTY: CheckContext['dns'] = {
  txt: [],
  caa: [],
  mx: [],
  dnssec: false,
  emailDomain: null,
  spfTxt: [],
  dmarcTxt: [],
}

export async function getDnsInfo(hostname: string): Promise<CheckContext['dns']> {
  const host = unbracket(hostname)
  if (isIP(host)) return EMPTY // IP literals have no zone to query

  const emailDomain = organizationalDomain(host)

  const [txt, caa, mx, spfTxt, dmarcTxt] = await Promise.all([
    txtRecords(host),
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
    // Skip the duplicate query when the page host already IS the mail domain.
    emailDomain && emailDomain !== host ? txtRecords(emailDomain) : Promise.resolve<string[] | null>(null),
    emailDomain ? txtRecords(`_dmarc.${emailDomain}`) : Promise.resolve<string[]>([]),
  ])

  return {
    txt,
    caa,
    mx,
    dnssec: false,
    emailDomain,
    spfTxt: emailDomain ? (spfTxt ?? txt) : [],
    dmarcTxt,
  }
}

/** TXT values arrive chunked in 255-byte pieces; join them back into one string. */
function txtRecords(name: string): Promise<string[]> {
  return resolveTxt(name).then(
    (records) => records.map((chunks) => chunks.join('')),
    () => [],
  )
}
