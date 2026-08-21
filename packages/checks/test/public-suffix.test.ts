/**
 * organizationalDomain decides whether the email checks speak at all, so its
 * failure mode matters more than its coverage: returning a WRONG domain makes
 * SPF/DMARC report on records they never queried, while returning null merely
 * makes them stay quiet. Every case below is chosen to pin that asymmetry.
 */

import { describe, expect, it } from 'vitest'
import { organizationalDomain } from '../src/context/public-suffix.ts'

describe('organizationalDomain', () => {
  it('returns a two-label domain unchanged', () => {
    expect(organizationalDomain('example.com')).toBe('example.com')
    expect(organizationalDomain('stripe.io')).toBe('stripe.io')
  })

  it('strips a leading www., which is presentation and never a mail boundary', () => {
    expect(organizationalDomain('www.example.com')).toBe('example.com')
    expect(organizationalDomain('www.example.co.uk')).toBe('example.co.uk')
  })

  it('keeps the third label when the last two are a registry suffix', () => {
    expect(organizationalDomain('example.co.uk')).toBe('example.co.uk')
    expect(organizationalDomain('example.com.au')).toBe('example.com.au')
    expect(organizationalDomain('example.co.in')).toBe('example.co.in')
    expect(organizationalDomain('example.com.br')).toBe('example.com.br')
  })

  it('refuses to answer for deeper sub-domains, whose records may be inherited', () => {
    // blog.example.com may have no _dmarc of its own and still be covered by
    // example.com's policy. Reporting "missing" here would be a false positive.
    expect(organizationalDomain('blog.example.com')).toBeNull()
    expect(organizationalDomain('app.staging.example.com')).toBeNull()
    expect(organizationalDomain('shop.example.co.uk')).toBeNull()
  })

  it('never returns a bare registry suffix as somebody\'s domain', () => {
    expect(organizationalDomain('co.uk')).toBeNull()
    expect(organizationalDomain('com.au')).toBeNull()
  })

  it('refuses single-label and empty hosts', () => {
    expect(organizationalDomain('localhost')).toBeNull()
    expect(organizationalDomain('')).toBeNull()
    expect(organizationalDomain('   ')).toBeNull()
  })

  it('normalises case and a trailing root dot', () => {
    expect(organizationalDomain('WWW.Example.COM')).toBe('example.com')
    expect(organizationalDomain('example.com.')).toBe('example.com')
  })

  it('rejects malformed input rather than guessing', () => {
    expect(organizationalDomain('example..com')).toBeNull()
    expect(organizationalDomain('example.com:443')).toBeNull()
    expect(organizationalDomain('example.com/path')).toBeNull()
  })

  it('treats a www-only host as unresolvable, not as the domain "www"', () => {
    expect(organizationalDomain('www')).toBeNull()
    expect(organizationalDomain('www.localhost')).toBeNull()
  })
})
