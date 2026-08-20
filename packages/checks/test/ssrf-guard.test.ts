/**
 * SSRF guard tests — the one module where a missed case is a security incident,
 * so the ranges are pinned as tables rather than a few spot checks.
 *
 * The assertSafeUrl literal-IP block is a REGRESSION test: Node skips the
 * socket `lookup` hook for IP-literal hosts, so guardedLookup never runs for
 * "http://127.0.0.1" — assertSafeUrl is the only wall on that path (including
 * every redirect hop). It silently reaching connect() was a real Phase 0 bug.
 */

import { describe, expect, it } from 'vitest'
import { assertSafeUrl, isPrivateAddress, SsrfError, unbracket } from '../src/context/ssrf-guard.ts'

const BLOCKED_V4 = [
  ['0.0.0.1', '"this network"'],
  ['10.0.0.1', 'RFC 1918'],
  ['10.255.255.255', 'RFC 1918 upper edge'],
  ['100.64.0.1', 'CGNAT'],
  ['127.0.0.1', 'loopback'],
  ['169.254.169.254', 'link-local / cloud metadata'],
  ['172.16.0.1', 'RFC 1918 lower edge'],
  ['172.31.255.255', 'RFC 1918 upper edge'],
  ['192.0.0.1', 'IETF assignments'],
  ['192.0.2.1', 'TEST-NET-1'],
  ['192.168.1.1', 'RFC 1918'],
  ['198.18.0.1', 'benchmarking'],
  ['198.51.100.7', 'TEST-NET-2'],
  ['203.0.113.9', 'TEST-NET-3'],
  ['224.0.0.1', 'multicast'],
  ['240.0.0.1', 'reserved'],
  ['255.255.255.255', 'broadcast'],
] as const

const PUBLIC_V4 = [
  ['1.1.1.1', 'Cloudflare DNS'],
  ['8.8.8.8', 'Google DNS'],
  ['93.184.215.14', 'example.com'],
  ['100.63.255.255', 'just below CGNAT'],
  ['100.128.0.0', 'just above CGNAT'],
  ['172.15.255.255', 'just below RFC 1918 /12'],
  ['172.32.0.0', 'just above RFC 1918 /12'],
  ['192.167.255.255', 'just below 192.168/16'],
  ['198.17.255.255', 'just below benchmarking'],
  ['223.255.255.255', 'last unicast before multicast'],
] as const

const BLOCKED_V6 = [
  ['::', 'unspecified'],
  ['::1', 'loopback'],
  ['fe80::1', 'link-local'],
  ['fc00::1', 'unique local'],
  ['fd12:3456:789a::1', 'unique local (fd)'],
  ['ff02::1', 'multicast'],
  ['::ffff:10.0.0.1', 'mapped RFC 1918'],
  ['::ffff:127.0.0.1', 'mapped loopback'],
  ['::ffff:169.254.169.254', 'mapped metadata'],
  ['2002:a00:1::', '6to4 embedding 10.0.0.1'],
  ['64:ff9b::7f00:1', 'NAT64 embedding 127.0.0.1'],
] as const

const PUBLIC_V6 = [
  ['2606:4700:4700::1111', 'Cloudflare DNS'],
  ['2001:4860:4860::8888', 'Google DNS'],
  ['::ffff:8.8.8.8', 'mapped public v4'],
  ['2002:101:101::', '6to4 embedding 1.1.1.1'],
  ['64:ff9b::808:808', 'NAT64 embedding 8.8.8.8'],
] as const

describe('isPrivateAddress', () => {
  it.each(BLOCKED_V4)('blocks IPv4 %s (%s)', (ip) => expect(isPrivateAddress(ip)).toBe(true))
  it.each(PUBLIC_V4)('allows IPv4 %s (%s)', (ip) => expect(isPrivateAddress(ip)).toBe(false))
  it.each(BLOCKED_V6)('blocks IPv6 %s (%s)', (ip) => expect(isPrivateAddress(ip)).toBe(true))
  it.each(PUBLIC_V6)('allows IPv6 %s (%s)', (ip) => expect(isPrivateAddress(ip)).toBe(false))

  it('refuses anything that is not an IP literal at all', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true)
    expect(isPrivateAddress('')).toBe(true)
  })
})

describe('unbracket', () => {
  it('strips URL-style brackets from IPv6 literals only', () => {
    expect(unbracket('[::1]')).toBe('::1')
    expect(unbracket('example.com')).toBe('example.com')
  })
})

describe('assertSafeUrl', () => {
  const rejects = (url: string) => expect(() => assertSafeUrl(new URL(url))).toThrow(SsrfError)
  const accepts = (url: string) => expect(() => assertSafeUrl(new URL(url))).not.toThrow()

  it('rejects non-http(s) schemes', () => {
    rejects('ftp://example.com/')
    rejects('file:///etc/passwd')
  })

  it('rejects embedded credentials', () => {
    rejects('https://user:pass@example.com/')
  })

  it('REGRESSION: rejects private IP literals, which bypass the socket lookup hook', () => {
    rejects('http://127.0.0.1/')
    rejects('http://127.0.0.1:8080/admin')
    rejects('http://169.254.169.254/latest/meta-data/')
    rejects('http://10.0.0.1/')
    rejects('http://[::1]/')
    rejects('http://[fe80::1]/')
  })

  it('rejects shorthand/hex IP forms via WHATWG canonicalisation', () => {
    // The URL parser normalises these to dotted-decimal BEFORE our check runs —
    // pin that assumption, because the guard depends on it.
    expect(new URL('http://0x7f000001/').hostname).toBe('127.0.0.1')
    rejects('http://0x7f000001/')
    rejects('http://127.1/')
    rejects('http://2130706433/') // 127.0.0.1 as a decimal integer
  })

  it('accepts public hosts and public IP literals', () => {
    accepts('https://example.com/')
    accepts('http://8.8.8.8/')
    accepts('https://[2606:4700:4700::1111]/')
  })
})
