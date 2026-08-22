/**
 * Turning what a person typed into a URL the engine can accept.
 *
 * People paste "example.com", "www.Example.COM/blog?x=1", "http://foo.dev" and
 * the occasional "javascript:alert(1)". One function owns that translation so
 * the browser and the API route can never disagree about what a submission
 * meant — the client uses it for instant feedback, the server re-runs it
 * because nothing arriving over the wire is trusted.
 *
 * What this is NOT: a security boundary. It rejects obvious nonsense so the
 * user gets a sentence instead of a stack trace, but the authority on whether a
 * target may be fetched at all is assertSafeUrl() in @darvin/checks, which runs
 * on the server and blocks private ranges, cloud metadata and IP literals.
 */

/** Longer than any real page URL; anything past this is a paste accident or abuse. */
const MAX_INPUT_LENGTH = 2048

export type ScanTarget =
  | { readonly ok: true; readonly url: string; readonly hostname: string }
  | { readonly ok: false; readonly reason: string }

/**
 * A scheme is only a scheme when it is followed by "//". Without that rule
 * "example.com:8080" parses as the scheme "example.com", and the port silently
 * becomes the path.
 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

export function normalizeScanTarget(input: string): ScanTarget {
  const trimmed = input.trim()

  if (!trimmed) return { ok: false, reason: 'Enter a website address to scan.' }
  if (trimmed.length > MAX_INPUT_LENGTH) {
    return { ok: false, reason: 'That address is too long to be a real page URL.' }
  }

  // "//example.com" is protocol-relative; the leading slashes would otherwise
  // survive the prefix and produce an empty host.
  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { ok: false, reason: `"${trimmed}" is not a valid web address.` }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http:// and https:// addresses can be scanned.' }
  }

  if (url.username || url.password) {
    return { ok: false, reason: 'Remove the username and password from the address before scanning.' }
  }

  // A trailing root dot is legal in DNS but never what someone means to type.
  const hostname = url.hostname.replace(/\.$/, '')
  if (!hostname) return { ok: false, reason: 'That address has no domain name in it.' }

  // Bracketed IPv6 has no dots; every other real target does. Single-label hosts
  // ("localhost", an intranet name) resolve to nothing a public scanner can reach.
  const isIpv6Literal = hostname.startsWith('[') && hostname.endsWith(']')
  if (!isIpv6Literal && !hostname.includes('.')) {
    return { ok: false, reason: `"${hostname}" is not a public domain — try something like example.com.` }
  }

  url.hostname = hostname
  url.hash = '' // never sent to the server, so it is noise in a stored URL

  return { ok: true, url: url.href, hostname }
}
