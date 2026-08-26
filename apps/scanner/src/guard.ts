/**
 * SSRF containment for a service whose whole job is to point a real browser at
 * a URL somebody handed it.
 *
 * This is the most dangerous component in the system by a wide margin. Every
 * other part of the scanner makes a single HTTP request through safeFetch,
 * which validates the address and every redirect hop. Chromium does not: it
 * follows redirects itself, resolves its own DNS, loads subresources from any
 * origin the page names, and will happily fetch http://169.254.169.254/ if the
 * page under test contains an image tag pointing there.
 *
 * So there are three layers, and none of them is sufficient alone:
 *
 *   1. A shared secret on the HTTP endpoint. Without it this service is an
 *      open browser proxy — anyone who finds the port can render any internal
 *      URL and read the result.
 *   2. assertSafeUrl on the requested target, which resolves the hostname and
 *      rejects private, loopback, link-local and reserved addresses before a
 *      browser is ever launched.
 *   3. A request interceptor inside the page, re-checking EVERY request the
 *      page makes — subresources, XHR, redirects — because the target being
 *      safe says nothing about what its HTML asks for next.
 *
 * What this does not solve: DNS rebinding. Chromium resolves independently of
 * us, so a hostname that answers with a public address for our check and a
 * private one for the browser would slip through. Mitigating that properly
 * needs a resolver we control for the browser process. It is recorded here
 * rather than left implicit — the shared secret is what makes the residual
 * risk acceptable, since only our own backend can reach this service.
 */

import { assertSafeUrl, isPrivateAddress, resolvePublicAddresses, SsrfError, unbracket } from '@darvin/checks'
import { isIP } from 'node:net'

/** Chromium speaks more schemes than we ever want followed. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Verifies the target before a browser touches it. Throws SsrfError with a
 * message safe to return to the caller.
 */
export async function assertRenderable(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new SsrfError(`Not a URL: ${raw}`)
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfError(`Refusing to render ${url.protocol} — only http and https are allowed`)
  }
  // Synchronous, and deliberately DNS-free: in the engine, addresses are
  // checked by safeFetch's socket-level `lookup` hook at connect time. A
  // browser has no such hook, so the resolution has to happen here instead.
  assertSafeUrl(url)

  // Throws when every address the name resolves to is private or reserved.
  await resolvePublicAddresses(unbracket(url.hostname))
  return url
}

/**
 * Per-request verdict for the page's own traffic, memoised per hostname for
 * the life of one render.
 *
 * Returns true when the request may proceed. Deliberately fails CLOSED: a
 * hostname we cannot resolve is blocked, because "we do not know where this
 * goes" is not a reason to let a browser go there.
 */
export function makeRequestGuard(): (requestUrl: string) => Promise<boolean> {
  const verdicts = new Map<string, Promise<boolean>>()

  return (requestUrl) => {
    let url: URL
    try {
      url = new URL(requestUrl)
    } catch {
      return Promise.resolve(false)
    }
    // data:, blob: and about: never leave the browser, so they are not an
    // egress risk and blocking them would break ordinary pages.
    if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'about:') {
      return Promise.resolve(true)
    }
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return Promise.resolve(false)

    const host = unbracket(url.hostname)
    const cached = verdicts.get(host)
    if (cached) return cached

    const verdict = resolveVerdict(host)
    verdicts.set(host, verdict)
    return verdict
  }
}

async function resolveVerdict(host: string): Promise<boolean> {
  // An IP literal never reaches the resolver, so it has to be judged directly
  // — the same trap that made assertSafeUrl check literals itself.
  if (isIP(host)) return !isPrivateAddress(host)

  try {
    const addresses = await resolvePublicAddresses(host)
    return addresses.length > 0
  } catch {
    return false // unresolvable, or every address was private
  }
}
