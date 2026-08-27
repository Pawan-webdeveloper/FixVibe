/**
 * DNS context: the records a scan can learn about a domain in one pass.
 *
 * Notes for the next reader:
 *  - Every resolver call degrades rather than failing the scan. NXDOMAIN and
 *    missing record types degrade to an empty result — definitive absence.
 *    Timeouts and server failures degrade to `'unknown'` on TXT lookups, so
 *    the email checks stay silent instead of reporting "no record" off a dead
 *    resolver.
 *  - `emailDomain` is null whenever the organizational domain cannot be derived
 *    without a Public Suffix List (see public-suffix.ts). Null propagates as
 *    empty record lists, and the email checks stay silent on it: reporting
 *    "no DMARC record" for a name we never queried would be a lie.
 *  - CAA is resolved by RFC 8659's tree climb, not a single query: the record
 *    set that binds a CA may live on any ancestor of the scanned host.
 *  - There is deliberately no `dnssec` field. Node's resolver cannot surface
 *    the AD bit and offers no DNSKEY or DS rrtype, so answering it needs a DoH
 *    request to a third-party validating resolver on every scan. A field that
 *    is always false is worse than no field: it reads as an answer, and the
 *    first check built on it fires on every site on the internet.
 */

import { isIP } from 'node:net'
import { resolveTxt, resolveCaa, resolveMx } from 'node:dns/promises'
import type { CheckContext } from '../types.ts'
import { unbracket } from './ssrf-guard.ts'
import { organizationalDomain } from './public-suffix.ts'
import { safeFetch } from './safe-fetch.ts'

const EMPTY: CheckContext['dns'] = {
  txt: [],
  caa: null,
  mx: [],
  emailDomain: null,
  spfTxt: [],
  dmarcTxt: [],
  dkim: { selectors: {}, wildcard: null },
  registration: null,
}

/**
 * The selectors the large senders publish under.
 *
 * DKIM selectors are chosen by whoever signs the mail and cannot be enumerated
 * from outside — the only reliable way to learn one is to read a signed
 * message. So this is a curated list of provider defaults, and finding nothing
 * means exactly that: no selector WE KNOW OF. The check built on it says so.
 */
const DKIM_SELECTORS = [
  'google', // Google Workspace
  'selector1', // Microsoft 365
  'selector2',
  'k1', // Mailchimp / Mandrill
  'k2',
  'k3',
  's1', // SendGrid, Zoho and others
  's2',
  'mail',
  'default',
  'dkim',
  'zoho',
  'protonmail',
  'pm',
  'fm1', // Fastmail
  'mandrill',
  'sig1', // Zoho / iCloud
  'smtp', // Amazon SES uses a hashed selector, but this catches manual setups
  'hs1', // HubSpot
  'hs2',
  'ctct1', // Constant Contact
  'ctct2',
  'dkim1', // common hand-rolled names
  'key1',
  'key2',
] as const

export async function getDnsInfo(hostname: string): Promise<CheckContext['dns']> {
  const host = unbracket(hostname)
  if (isIP(host)) return EMPTY // IP literals have no zone to query

  const emailDomain = organizationalDomain(host)

  const [txt, caa, mx, spfTxt, dmarcTxt, dkim, registration] = await Promise.all([
    txtRecords(host),
    governingCaa(host),
    resolveMx(host).then(
      (records) =>
        [...records]
          .sort((a, b) => a.priority - b.priority)
          .map((record) => record.exchange)
          // RFC 7505: a single `MX 0 .` is a NULL MX — an explicit declaration
          // that the domain accepts no mail. Node renders the root label as an
          // empty string, so without this filter `mx.length > 0` reads a
          // "we receive no mail" statement as "we run a mail server", and
          // example.com is one of the domains that publishes it.
          .filter((exchange) => exchange !== '' && exchange !== '.'),
      () => [],
    ),
    // Skip the duplicate query when the page host already IS the mail domain.
    emailDomain && emailDomain !== host
      ? txtRecords(emailDomain)
      : Promise.resolve<TxtRecords | null>(null),
    emailDomain ? txtRecords(`_dmarc.${emailDomain}`) : Promise.resolve<TxtRecords>([]),
    emailDomain
      ? dkimRecords(emailDomain)
      : Promise.resolve<CheckContext['dns']['dkim']>({ selectors: {}, wildcard: null }),
    emailDomain ? registrationInfo(emailDomain) : Promise.resolve(null),
  ])

  return {
    txt,
    caa,
    mx,
    emailDomain,
    spfTxt: emailDomain ? ((spfTxt ?? txt) as TxtRecords) : [],
    dmarcTxt,
    dkim,
    registration,
  }
}

/**
 * The CAA set that actually governs issuance for `host`, per RFC 8659 §3.
 *
 * A CA about to issue does not query one name — it walks up the tree from the
 * subject name and uses the FIRST ancestor that publishes any CAA record. So
 * querying only `www.example.com` and finding nothing tells us nothing: the
 * policy binding every CA on earth may sit one label up. The climb stops
 * short of the bare TLD, which nobody publishes issuance policy at.
 *
 * All names are queried at once and the closest answer wins. That is a few
 * extra UDP round trips against a caching resolver, in exchange for one round
 * trip of latency instead of one per label.
 *
 * Returns null when any name closer than the first hit could not be read: a
 * name we failed to query might have held a set that shadows the one we
 * found, and reporting a policy that may not apply is worse than silence.
 */
async function governingCaa(host: string): Promise<CheckContext['dns']['caa']> {
  const labels = host.split('.').filter(Boolean)
  // Two labels minimum: the climb ends below the TLD.
  const names = labels.length < 2 ? [] : labels.map((_, i) => labels.slice(i).join('.')).slice(0, labels.length - 1)
  if (names.length === 0) return null

  const answers = await Promise.all(names.map(caaAt))

  for (const [index, answer] of answers.entries()) {
    if (answer === 'unknown') return null
    if (answer.length > 0) return { name: names[index]!, records: answer }
  }

  // Asked every name up to the TLD; all answered, none published anything.
  return { name: names[names.length - 1]!, records: [] }
}

/**
 * Either the definitive record set, or `'unknown'` when the query itself
 * failed. NXDOMAIN and ENODATA prove absence; a timeout or SERVFAIL does not,
 * and reporting "no SPF record" off a dead resolver is exactly the false
 * positive class this sentinel exists to prevent (the CAA climb below already
 * worked this way).
 */
export type TxtRecords = string[] | 'unknown'

/** Definitive DNS "no such record" codes — anything else means we failed to ask. */
const NO_RECORDS = new Set(['ENODATA', 'ENOTFOUND'])

/** CAA at exactly one name: the records, or 'unknown' when the query failed. */
function caaAt(name: string): Promise<string[] | 'unknown'> {
  return resolveCaa(name).then(
    (records) =>
      records.map((record) => {
        if (record.issue !== undefined) return `issue "${record.issue}"`
        if (record.issuewild !== undefined) return `issuewild "${record.issuewild}"`
        if (record.iodef !== undefined) return `iodef "${record.iodef}"`
        return JSON.stringify(record)
      }),
    (error: NodeJS.ErrnoException) => (NO_RECORDS.has(error.code ?? '') ? [] : 'unknown'),
  )
}

/** TXT values arrive chunked in 255-byte pieces; join them back into one string. */
function txtRecords(name: string): Promise<TxtRecords> {
  return resolveTxt(name).then(
    (records) => records.map((chunks) => chunks.join('')),
    (error: NodeJS.ErrnoException) => (NO_RECORDS.has(error.code ?? '') ? [] : 'unknown'),
  )
}

/**
 * A selector nobody would ever configure. If THIS name answers, the zone has a
 * wildcard under `_domainkey` and every selector we try will "match".
 */
const WILDCARD_CONTROL = 'scanlyfix-wildcard-control'

/**
 * All selectors plus the control are tried at once. Twenty-six DNS lookups
 * sounds like a lot and costs a few milliseconds — they are UDP round trips to
 * a resolver that has most of them cached, and doing them in sequence would be
 * the only version of this that was actually slow.
 *
 * The control query is the point of this function. example.com publishes
 * `*._domainkey` = "v=DKIM1; p=" (RFC 6376 §3.6.1: no key, signs nothing), so
 * without it a scan reports eighteen DKIM keys on a domain that has none.
 * Under a wildcard `selectors` is left empty on purpose: no individual name
 * answering is evidence of anything.
 */
async function dkimRecords(domain: string): Promise<CheckContext['dns']['dkim']> {
  const names = [WILDCARD_CONTROL, ...DKIM_SELECTORS]
  const answers = await Promise.all(names.map((selector) => dkimAt(selector, domain)))

  const [wildcard] = answers
  if (wildcard && wildcard.length > 0) return { selectors: {}, wildcard }

  const selectors: Record<string, string[]> = {}
  for (const [index, records] of answers.entries()) {
    if (index === 0 || records.length === 0) continue
    selectors[names[index]!] = records
  }
  return { selectors, wildcard: null }
}

/** DKIM records at one selector — unrelated TXT at the same name is discarded.
 *  A query failure reads as "no record here", which is safe: most selectors
 *  answer nothing anyway, and the check never treats absence as a defect on
 *  its own (see the sendsMail gate in email/dkim.ts). */
async function dkimAt(selector: string, domain: string): Promise<string[]> {
  const records = await txtRecords(`${selector}._domainkey.${domain}`)
  return records === 'unknown' ? [] : records.filter((record) => /v\s*=\s*DKIM1/i.test(record))
}

/**
 * Domain registration through RDAP — the JSON successor to WHOIS.
 *
 * rdap.org redirects to whichever registry owns the TLD, so one URL covers all
 * of them without shipping a bootstrap table. Everything degrades to null: many
 * ccTLD registries publish no RDAP endpoint at all, and plenty of the rest
 * withhold dates, so absence here says nothing about the domain.
 */
async function registrationInfo(domain: string): Promise<CheckContext['dns']['registration']> {
  try {
    const response = await safeFetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      timeoutMs: 6_000,
      maxBodyBytes: 256 * 1024,
      headers: { accept: 'application/rdap+json' },
    })
    if (response.status !== 200) return null

    const body = JSON.parse(response.body) as {
      events?: Array<{ eventAction?: string; eventDate?: string }>
      entities?: Array<{ roles?: string[]; vcardArray?: unknown }>
    }

    const expiration = body.events?.find((event) => event.eventAction === 'expiration')?.eventDate ?? null
    const registrar =
      body.entities?.find((entity) => entity.roles?.includes('registrar'))?.vcardArray instanceof Array
        ? registrarName(body.entities.find((entity) => entity.roles?.includes('registrar'))?.vcardArray)
        : null

    return { expiresAt: expiration, registrar }
  } catch {
    // Unreachable, blocked, or not JSON. Silence is the honest result.
    return null
  }
}

/** jCard: ['vcard', [['fn', {}, 'text', 'Registrar Name'], ...]]. */
function registrarName(vcardArray: unknown): string | null {
  if (!Array.isArray(vcardArray) || !Array.isArray(vcardArray[1])) return null
  for (const entry of vcardArray[1] as unknown[]) {
    if (Array.isArray(entry) && entry[0] === 'fn' && typeof entry[3] === 'string') return entry[3]
  }
  return null
}
