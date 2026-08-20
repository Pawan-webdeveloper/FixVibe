/**
 * Unit tests for the TLS trio: certificate expiry, protocol version, and
 * HTTP→HTTPS enforcement. All time-sensitive cases use offsets from "now"
 * (tlsExpiringIn) so nothing in here rots into a failing test next year.
 */

import { describe, expect, it } from 'vitest'
import type { Check, Finding } from '../src/types.ts'
import { certExpiryCheck } from '../src/security/tls/cert-expiry.ts'
import { httpsRedirectCheck } from '../src/security/tls/https-redirect.ts'
import { tlsProtocolVersionCheck } from '../src/security/tls/protocol-version.ts'
import { makeContext, tlsExpiringIn, type ContextOverrides } from './helpers.ts'

const run = async (check: Check, overrides: ContextOverrides = {}): Promise<Finding[]> =>
  check.run(makeContext(overrides))

describe('security.tls.cert-expiry', () => {
  it('skips when TLS could not be inspected', async () => {
    expect(await run(certExpiryCheck, { tls: null })).toEqual([])
  })

  it('is silent with plenty of runway', async () => {
    expect(await run(certExpiryCheck, { tls: tlsExpiringIn(90) })).toEqual([])
  })

  it('flags an expired certificate as critical', async () => {
    const findings = await run(certExpiryCheck, { tls: tlsExpiringIn(-3) })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('critical')
  })

  it('escalates by time left: ≤14 days high, ≤30 days medium', async () => {
    expect((await run(certExpiryCheck, { tls: tlsExpiringIn(10) }))[0]!.severity).toBe('high')
    expect((await run(certExpiryCheck, { tls: tlsExpiringIn(25) }))[0]!.severity).toBe('medium')
  })

  it('skips an unparseable valid_to instead of reporting NaN days', async () => {
    const findings = await run(certExpiryCheck, {
      tls: { validTo: new Date('not a date'), protocol: 'TLSv1.3', issuer: 'Test CA' },
    })
    expect(findings).toEqual([])
  })
})

describe('security.tls.protocol-version', () => {
  it('accepts TLS 1.2 and 1.3', async () => {
    expect(await run(tlsProtocolVersionCheck, { tls: tlsExpiringIn(90, 'TLSv1.3') })).toEqual([])
    expect(await run(tlsProtocolVersionCheck, { tls: tlsExpiringIn(90, 'TLSv1.2') })).toEqual([])
  })

  it('flags TLS 1.0/1.1 as high', async () => {
    expect((await run(tlsProtocolVersionCheck, { tls: tlsExpiringIn(90, 'TLSv1.1') }))[0]!.severity).toBe('high')
    expect((await run(tlsProtocolVersionCheck, { tls: tlsExpiringIn(90, 'TLSv1') }))[0]!.severity).toBe('high')
  })

  it('flags any SSLv* as critical', async () => {
    expect((await run(tlsProtocolVersionCheck, { tls: tlsExpiringIn(90, 'SSLv3') }))[0]!.severity).toBe('critical')
  })

  it('skips when TLS could not be inspected', async () => {
    expect(await run(tlsProtocolVersionCheck, { tls: null })).toEqual([])
  })
})

describe('security.tls.https-redirect', () => {
  it('flags a site served over plain http as critical', async () => {
    const findings = await run(httpsRedirectCheck, { url: 'http://site.test/', finalUrl: 'http://site.test/' })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('critical')
  })

  it('passes when an http entry URL upgraded to https during the scan', async () => {
    const findings = await run(httpsRedirectCheck, {
      url: 'http://site.test/',
      finalUrl: 'https://site.test/',
      redirectChain: ['http://site.test/'],
    })
    expect(findings).toEqual([])
  })

  it('flags an http entry that detours through another http hop before https', async () => {
    const findings = await run(httpsRedirectCheck, {
      url: 'http://site.test/',
      finalUrl: 'https://www.site.test/',
      redirectChain: ['http://site.test/', 'http://www.site.test/'],
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('low')
  })

  it('passes when port 80 is closed (nothing to strip)', async () => {
    expect(await run(httpsRedirectCheck, { httpProbe: null })).toEqual([])
  })

  it('passes on a direct http→https redirect', async () => {
    const findings = await run(httpsRedirectCheck, {
      httpProbe: { status: 301, location: 'https://site.test/' },
    })
    expect(findings).toEqual([])
  })

  it('flags an http→http first hop as low', async () => {
    const findings = await run(httpsRedirectCheck, {
      httpProbe: { status: 302, location: 'http://site.test/login' },
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('low')
  })

  it('flags content served on http without redirect as high', async () => {
    const findings = await run(httpsRedirectCheck, { httpProbe: { status: 200, location: null } })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('high')
  })

  it('treats 4xx/5xx on port 80 as refused, not a finding', async () => {
    expect(await run(httpsRedirectCheck, { httpProbe: { status: 403, location: null } })).toEqual([])
  })
})
