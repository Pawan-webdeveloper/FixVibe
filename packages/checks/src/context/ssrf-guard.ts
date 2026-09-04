/**
 * SSRF guard — the one wall between "scan any URL" and "scan our own network".
 *
 * Threat model: a user submits a URL whose hostname resolves to something we
 * must never touch — localhost, RFC-1918 space, link-local (incl. the cloud
 * metadata service at 169.254.169.254), or any of those tunnelled through an
 * IPv6 transition prefix. DNS rebinding is in scope too: the address we
 * validate MUST be the address we connect to. That is why this module exposes
 * `guardedLookup`, which safe-fetch/tls plug into the socket layer — validation
 * and connection share a single DNS resolution, leaving no gap to rebind into.
 */

import { isIP, type LookupFunction } from 'node:net'
import type { LookupAddress } from 'node:dns'
import { lookup } from 'node:dns/promises'

/** Thrown whenever a target is refused. Callers surface `message` to the user as-is. */
export class SsrfError extends Error {
  override name = 'SsrfError'
}

// ---------------------------------------------------------------------------
// IPv4
// ---------------------------------------------------------------------------

/** "10.1.2.3" → 0x0a010203, or null when not a strict dotted quad. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  // Keep the result an unsigned 32-bit int (>>> 0) so range maths below works.
  return value >>> 0
}

// Blocked IPv4 space: everything that is not unambiguously public internet.
// [network, prefixLength] — kept sorted for the reader, not the machine.
const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], //        "this network" / unspecified
  ['10.0.0.0', 8], //       RFC 1918 private
  ['100.64.0.0', 10], //    carrier-grade NAT
  ['127.0.0.0', 8], //      loopback
  ['169.254.0.0', 16], //   link-local — includes cloud metadata 169.254.169.254
  ['172.16.0.0', 12], //    RFC 1918 private
  ['192.0.0.0', 24], //     IETF protocol assignments
  ['192.0.2.0', 24], //     TEST-NET-1
  ['192.168.0.0', 16], //   RFC 1918 private
  ['198.18.0.0', 15], //    benchmarking
  ['198.51.100.0', 24], //  TEST-NET-2
  ['203.0.113.0', 24], //   TEST-NET-3
  ['224.0.0.0', 4], //      multicast
  ['240.0.0.0', 4], //      reserved + broadcast 255.255.255.255
]

const BLOCKED_IPV4 = BLOCKED_IPV4_RANGES.map(([network, prefix]) => ({
  base: ipv4ToInt(network)! >>> (32 - prefix),
  shift: 32 - prefix,
}))

function isBlockedIpv4Int(value: number): boolean {
  return BLOCKED_IPV4.some(({ base, shift }) => value >>> shift === base)
}

// ---------------------------------------------------------------------------
// IPv6
// ---------------------------------------------------------------------------

/**
 * Expand an IPv6 literal into its eight 16-bit groups. Handles "::" compression
 * and the embedded-IPv4 tail form ("::ffff:127.0.0.1"). Returns null on
 * malformed input — callers treat unparseable as blocked, never as public.
 */
function parseIpv6(raw: string): number[] | null {
  // Zone index ("%eth0") is host-local routing info; irrelevant to range checks.
  let ip = raw.split('%')[0]!.toLowerCase()

  // Rewrite a trailing dotted quad as two hex groups so one code path handles both forms.
  if (ip.includes('.')) {
    const lastColon = ip.lastIndexOf(':')
    const v4 = ipv4ToInt(ip.slice(lastColon + 1))
    if (v4 === null) return null
    ip = `${ip.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }

  const halves = ip.split('::')
  if (halves.length > 2) return null

  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []

  let groups: string[]
  if (halves.length === 1) {
    if (left.length !== 8) return null
    groups = left
  } else {
    const missing = 8 - left.length - right.length
    if (missing < 1) return null
    groups = [...left, ...Array<string>(missing).fill('0'), ...right]
  }

  const parsed: number[] = []
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null
    parsed.push(parseInt(group, 16))
  }
  return parsed
}

function isBlockedIpv6(ip: string): boolean {
  const groups = parseIpv6(ip)
  if (!groups) return true // unparseable → refuse, never assume public

  const [g0, g1] = groups as [number, number, ...number[]]

  if (groups.every((g) => g === 0)) return true //                 :: unspecified
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true // ::1 loopback
  if ((g0 & 0xffc0) === 0xfe80) return true //                     fe80::/10 link-local
  if ((g0 & 0xfe00) === 0xfc00) return true //                     fc00::/7 unique local
  if ((g0 & 0xff00) === 0xff00) return true //                     ff00::/8 multicast

  // Transition prefixes smuggle an IPv4 address inside an IPv6 one — extract
  // the embedded address and apply the IPv4 rules to it.
  const embedded = (hi: number, lo: number) => isBlockedIpv4Int(((hi << 16) | lo) >>> 0)
  const leadingZero = (n: number) => groups.slice(0, n).every((g) => g === 0)

  if (leadingZero(5) && groups[5] === 0xffff) return embedded(groups[6]!, groups[7]!) // ::ffff:a.b.c.d mapped
  if (leadingZero(6)) return embedded(groups[6]!, groups[7]!) //   ::a.b.c.d IPv4-compatible (deprecated)
  if (g0 === 0x2002) return embedded(g1, groups[2]!) //            2002::/16 6to4
  if (g0 === 0x64 && g1 === 0xff9b) return embedded(groups[6]!, groups[7]!) // 64:ff9b::/96 NAT64

  return false
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** True when `ip` (v4 or v6 literal) must never be connected to. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) {
    const value = ipv4ToInt(ip)
    return value === null ? true : isBlockedIpv4Int(value)
  }
  if (family === 6) return isBlockedIpv6(ip)
  return true // not an IP literal at all → refuse
}

/** URL.hostname wraps IPv6 literals in brackets; strip them for net/dns APIs. */
export function unbracket(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

/**
 * Resolve a hostname and assert every address is public. Rejects if resolution
 * fails, returns nothing, or ANY record is private — a hostname mixing public
 * and private records is an attack, not a configuration quirk.
 */
export async function resolvePublicAddresses(hostname: string): Promise<LookupAddress[]> {
  const host = unbracket(hostname)

  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new SsrfError(`Refusing to scan private or reserved address: ${host}`)
    }
    return [{ address: host, family: isIP(host) }]
  }

  let addresses: LookupAddress[]
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    throw new SsrfError(`Could not resolve hostname: ${host}`)
  }
  if (addresses.length === 0) {
    throw new SsrfError(`Hostname has no addresses: ${host}`)
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new SsrfError(`Refusing to scan ${host}: it resolves to private address ${address}`)
    }
  }
  return addresses
}

/**
 * Rejects URLs that could smuggle a request somewhere unexpected before any DNS happens.
 * Called at the start of every redirect hop.
 */
export function assertSafeUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(`Only http(s) URLs can be scanned, got: ${url.protocol}//`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new SsrfError('URLs with embedded credentials are not allowed')
  }
  // Literal-IP hosts NEVER go through the socket's lookup hook (Node skips
  // `lookup` for addresses), so guardedLookup cannot save us here — this check
  // is the only wall for "http://127.0.0.1" and every redirect hop to an IP.
  // WHATWG URL canonicalises shorthand ("127.1", hex, octal) to dotted decimal
  // first, so the range check sees the real address.
  const host = unbracket(url.hostname)
  if (isIP(host) && isPrivateAddress(host)) {
    throw new SsrfError(`Refusing to scan private or reserved address: ${host}`)
  }
}

/**
 * Validates a redirect target URL. Blocks:
 *   - Protocol downgrade (https→http)
 *   - Non-http(s) schemes
 *   - Private/reserved IP literals
 *   - Embedded credentials
 *
 * Must be called for every redirect hop before making the next request.
 */
export function assertSafeRedirectUrl(currentUrl: URL, redirectUrl: URL): void {
  // Block non-http(s) schemes
  if (redirectUrl.protocol !== 'http:' && redirectUrl.protocol !== 'https:') {
    throw new SsrfError(`Redirect to non-http(s) URL blocked: ${redirectUrl.protocol}//...`)
  }

  // Block https→http protocol downgrade (SSRF via redirect)
  if (currentUrl.protocol === 'https:' && redirectUrl.protocol === 'http:') {
    throw new SsrfError(
      `Redirect from HTTPS to HTTP blocked (protocol downgrade): ${currentUrl.hostname} → ${redirectUrl.hostname}`,
    )
  }

  // Block embedded credentials
  if (redirectUrl.username !== '' || redirectUrl.password !== '') {
    throw new SsrfError('Redirect to URL with embedded credentials blocked')
  }

  // Block private/reserved IP literals (bypasses socket lookup hook)
  const host = unbracket(redirectUrl.hostname)
  if (isIP(host) && isPrivateAddress(host)) {
    throw new SsrfError(`Redirect to private or reserved address blocked: ${host}`)
  }
}

/**
 * Drop-in `lookup` for net/tls/undici sockets. Because the socket connects to
 * the exact addresses returned here, validate-then-connect is atomic and DNS
 * rebinding gets no second resolution to poison.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  resolvePublicAddresses(hostname).then(
    (addresses) => {
      const family = typeof options.family === 'number' ? options.family : 0
      const usable = family ? addresses.filter((a) => a.family === family) : addresses
      if (usable.length === 0) {
        callback(new SsrfError(`No IPv${family} address for ${hostname}`), [])
        return
      }
      if (options.all) {
        callback(null, usable)
      } else {
        // Non-`all` callers expect the legacy (err, address, family) shape.
        ;(callback as unknown as (e: Error | null, a: string, f: number) => void)(
          null,
          usable[0]!.address,
          usable[0]!.family,
        )
      }
    },
    (error: Error) => callback(error, []),
  )
}
