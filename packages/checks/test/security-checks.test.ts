/**
 * Unit tests for the eight Phase-1 batch-B security checks.
 *
 * These checks say things about a site that are expensive to get wrong — "your
 * session cookie is readable by scripts", "anyone can spoof your domain" — so
 * roughly half of what follows pins the cases where they must stay QUIET:
 * `~all` in SPF, `p=none` on its own, `Server: cloudflare`, an anchor with an
 * http:// href, a wildcard CORS header on a public page. A check that fires on
 * those is not thorough, it is wrong.
 */

import { describe, expect, it } from 'vitest'
import type { Check, Finding, ParsedCookie } from '../src/types.ts'
import { cookieFlagsCheck } from '../src/security/cookies/cookie-flags.ts'
import { corsWildcardCheck } from '../src/security/cors/cors-wildcard.ts'
import { serverHeaderCheck } from '../src/security/info-leak/server-header.ts'
import { xPoweredByCheck } from '../src/security/info-leak/x-powered-by.ts'
import { mixedContentCheck } from '../src/security/mixed-content.ts'
import { securityTxtCheck } from '../src/security/security-txt.ts'
import { spfCheck } from '../src/email/spf.ts'
import { dmarcCheck } from '../src/email/dmarc.ts'
import { makeContext, probeStub, securityTxt, type ContextOverrides } from './helpers.ts'

const run = async (check: Check, overrides: ContextOverrides = {}): Promise<Finding[]> =>
  check.run(makeContext(overrides))

const only = (findings: Finding[]): Finding => {
  expect(findings).toHaveLength(1)
  return findings[0]!
}

const titles = (findings: Finding[]): string[] => findings.map((f) => f.title).sort()

const cookie = (name: string, attributes: Partial<Omit<ParsedCookie, 'name'>> = {}): ParsedCookie => ({
  name,
  secure: false,
  httpOnly: false,
  sameSite: null,
  ...attributes,
})

/** Everything set correctly — the shape that must produce no finding at all. */
const perfectCookie = (name: string): ParsedCookie =>
  cookie(name, { secure: true, httpOnly: true, sameSite: 'Lax' })

/** A page body wrapped in an https document. */
const body = (markup: string): string =>
  `<!doctype html><html lang="en"><head><title>t</title></head><body>${markup}</body></html>`

// ---------------------------------------------------------------------------

describe('security.cookies.flags', () => {
  it('stays silent when the response sets no cookies', async () => {
    expect(await run(cookieFlagsCheck)).toEqual([])
  })

  it('stays silent on a fully configured cookie', async () => {
    expect(await run(cookieFlagsCheck, { cookies: [perfectCookie('sid')] })).toEqual([])
  })

  it('flags a missing Secure attribute on an HTTPS origin', async () => {
    const findings = await run(cookieFlagsCheck, {
      cookies: [cookie('prefs', { httpOnly: true, sameSite: 'Lax' })],
    })
    expect(only(findings).title).toBe('Cookies set without the Secure attribute')
    expect(only(findings).evidence).toEqual({ cookies: ['prefs'] })
  })

  it('does not judge Secure on a plain-HTTP origin, where browsers refuse it anyway', async () => {
    const findings = await run(cookieFlagsCheck, {
      url: 'http://site.test/',
      cookies: [cookie('prefs', { httpOnly: true, sameSite: 'Lax' })],
    })
    expect(titles(findings)).not.toContain('Cookies set without the Secure attribute')
  })

  it('reports one finding per attribute, not one per cookie', async () => {
    const cookies = ['a', 'b', 'c', 'd'].map((n) => cookie(n, { httpOnly: true, sameSite: 'Lax' }))
    const findings = await run(cookieFlagsCheck, { cookies })
    expect(findings).toHaveLength(1)
    expect(only(findings).evidence).toEqual({ cookies: ['a', 'b', 'c', 'd'] })
  })

  it('charges the score for a framework session cookie readable by scripts', async () => {
    const findings = await run(cookieFlagsCheck, {
      cookies: [cookie('PHPSESSID', { secure: true, sameSite: 'Lax' })],
    })
    expect(only(findings).title).toBe('Session cookies are readable by JavaScript')
    expect(only(findings).severity).toBe('medium')
  })

  it('records an analytics cookie without HttpOnly as a zero-penalty observation', async () => {
    // _ga is read by JavaScript by design. Charging the score for it would fire
    // on nearly every site on the internet.
    const findings = await run(cookieFlagsCheck, {
      cookies: [cookie('_ga', { secure: true, sameSite: 'Lax' })],
    })
    expect(only(findings).title).toBe('Cookies readable by JavaScript')
    expect(only(findings).severity).toBe('info')
  })

  it('recognises framework session names behind a __Host- prefix', async () => {
    const findings = await run(cookieFlagsCheck, {
      cookies: [cookie('__Host-next-auth.session-token', { secure: true, sameSite: 'Lax' })],
    })
    expect(only(findings).severity).toBe('medium')
  })

  it('flags SameSite=None without Secure, and does not double-charge it as missing Secure', async () => {
    const findings = await run(cookieFlagsCheck, {
      cookies: [cookie('embed', { httpOnly: true, sameSite: 'None' })],
    })
    expect(only(findings).title).toBe('SameSite=None cookies are missing Secure')
  })

  it('treats an absent and an unrecognised SameSite the same way', async () => {
    const absent = await run(cookieFlagsCheck, {
      cookies: [cookie('a', { secure: true, httpOnly: true })],
    })
    const bogus = await run(cookieFlagsCheck, {
      cookies: [cookie('a', { secure: true, httpOnly: true, sameSite: 'Loose' })],
    })
    expect(only(absent).title).toBe('Cookies without an explicit SameSite')
    expect(only(bogus).title).toBe('Cookies without an explicit SameSite')
  })
})

describe('security.cors.wildcard', () => {
  it('stays silent when the response carries no CORS headers', async () => {
    expect(await run(corsWildcardCheck)).toEqual([])
  })

  it('treats a bare wildcard on a public page as an observation, not a vulnerability', async () => {
    // "*" forbids credentialed requests by definition, and the page is public.
    const findings = await run(corsWildcardCheck, {
      headers: { 'access-control-allow-origin': '*' },
    })
    expect(only(findings).severity).toBe('info')
  })

  it('flags wildcard together with Allow-Credentials, which browsers reject outright', async () => {
    const findings = await run(corsWildcardCheck, {
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-credentials': 'true',
      },
    })
    expect(only(findings).title).toBe('CORS sends Allow-Origin: * with Allow-Credentials: true')
    expect(only(findings).severity).toBe('medium')
  })

  it('escalates the forgeable null origin when credentials are allowed', async () => {
    const findings = await run(corsWildcardCheck, {
      headers: {
        'access-control-allow-origin': 'null',
        'access-control-allow-credentials': 'true',
      },
    })
    expect(only(findings).severity).toBe('high')
  })

  it('stays silent on a single named origin with credentials — the normal correct case', async () => {
    const findings = await run(corsWildcardCheck, {
      headers: {
        'access-control-allow-origin': 'https://app.site.test',
        'access-control-allow-credentials': 'true',
      },
    })
    expect(findings).toEqual([])
  })

  it('flags a header carrying more than one origin, which no browser accepts', async () => {
    const findings = await run(corsWildcardCheck, {
      headers: { 'access-control-allow-origin': 'https://a.test, https://b.test' },
    })
    expect(only(findings).title).toBe('Access-Control-Allow-Origin carries more than one value')
  })
})

describe('security.info-leak.server', () => {
  it('stays silent when there is no Server header', async () => {
    expect(await run(serverHeaderCheck)).toEqual([])
  })

  it.each(['nginx', 'cloudflare', 'gws', 'AmazonS3', 'istio-envoy'])(
    'stays silent on the bare product name %s',
    async (server) => {
      expect(await run(serverHeaderCheck, { headers: { server } })).toEqual([])
    },
  )

  it('stays silent on an opaque CDN node id', async () => {
    expect(await run(serverHeaderCheck, { headers: { server: 'ECS (dcb/7F83)' } })).toEqual([])
  })

  it('flags an exact version and captures the raw header as evidence', async () => {
    const findings = await run(serverHeaderCheck, { headers: { server: 'Apache/2.2.15 (CentOS)' } })
    expect(only(findings).severity).toBe('low')
    expect(only(findings).title).toContain('2.2.15')
    expect(only(findings).evidence).toMatchObject({ header: 'Apache/2.2.15 (CentOS)' })
  })

  it.each(['nginx/1.18.0', 'Microsoft-IIS/8.5', 'openresty/1.21.4.1'])('flags %s', async (server) => {
    expect(await run(serverHeaderCheck, { headers: { server } })).toHaveLength(1)
  })
})

describe('security.info-leak.x-powered-by', () => {
  it('stays silent without the header', async () => {
    expect(await run(xPoweredByCheck)).toEqual([])
  })

  it('flags a version-bearing banner at low', async () => {
    const findings = await run(xPoweredByCheck, { headers: { 'x-powered-by': 'PHP/5.4.16' } })
    expect(only(findings).severity).toBe('low')
  })

  it('still reports a version-free banner, at zero score cost', async () => {
    const findings = await run(xPoweredByCheck, { headers: { 'x-powered-by': 'Express' } })
    expect(only(findings).severity).toBe('info')
  })
})

describe('security.mixed-content', () => {
  it('stays silent on a plain-HTTP page, where the concept does not apply', async () => {
    const findings = await run(mixedContentCheck, {
      url: 'http://site.test/',
      html: body('<script src="http://cdn.test/a.js"></script>'),
    })
    expect(findings).toEqual([])
  })

  it('flags a blocked active subresource', async () => {
    const findings = await run(mixedContentCheck, {
      html: body('<script src="http://cdn.test/a.js"></script>'),
    })
    expect(only(findings).title).toContain('Active mixed content')
  })

  it('separates passive references from active ones', async () => {
    const findings = await run(mixedContentCheck, {
      html: body('<script src="http://cdn.test/a.js"></script><img src="http://cdn.test/a.png">'),
    })
    expect(findings).toHaveLength(2)
    const active = findings.find((f) => f.title.startsWith('Active'))!
    const passive = findings.find((f) => f.title.startsWith('Passive'))!
    expect(SEVERITY_RANK[active.severity]).toBeLessThan(SEVERITY_RANK[passive.severity])
  })

  it('does not treat an http:// anchor as mixed content — a link is a navigation', async () => {
    const findings = await run(mixedContentCheck, {
      html: body('<a href="http://elsewhere.test/page">elsewhere</a>'),
    })
    expect(findings).toEqual([])
  })

  it('ignores http:// appearing in text and in JSON-LD', async () => {
    const findings = await run(mixedContentCheck, {
      html: body(
        '<p>Visit http://example.test for more</p>' +
          '<script type="application/ld+json">{"@id":"http://schema.org/Thing"}</script>',
      ),
    })
    expect(findings).toEqual([])
  })

  it('ignores protocol-relative references, which inherit https', async () => {
    const findings = await run(mixedContentCheck, {
      html: body('<script src="//cdn.test/a.js"></script><img src="//cdn.test/a.png">'),
    })
    expect(findings).toEqual([])
  })

  it('separates loopback references, which browsers never block', async () => {
    const findings = await run(mixedContentCheck, {
      html: body('<script src="http://localhost:3000/dev.js"></script>'),
    })
    expect(only(findings).title).toContain('localhost')
    expect(only(findings).severity).toBe('info')
  })

  it('caps the evidence sample instead of echoing an entire broken page', async () => {
    const images = Array.from({ length: 40 }, (_, i) => `<img src="http://cdn.test/${i}.png">`).join('')
    const findings = await run(mixedContentCheck, { html: body(images) })
    const evidence = only(findings).evidence as { total: number; sample: unknown[] }
    expect(evidence.total).toBe(40)
    expect(evidence.sample.length).toBeLessThanOrEqual(10)
  })
})

describe('security.security-txt', () => {
  it('says nothing when the probe could not reach the path', async () => {
    // null is "unknown", never "missing" — the probe cap or the network failed.
    expect(await run(securityTxtCheck, { probe: probeStub({}) })).toEqual([])
  })

  it('flags an outright 404 at low', async () => {
    const findings = await run(securityTxtCheck, {
      probe: probeStub({ '/.well-known/security.txt': { status: 404 } }),
    })
    expect(only(findings).title).toBe('No security.txt')
    expect(only(findings).severity).toBe('low')
  })

  it('accepts a well-formed, unexpired file', async () => {
    const findings = await run(securityTxtCheck, {
      probe: probeStub({ '/.well-known/security.txt': { status: 200, body: securityTxt(200) } }),
    })
    expect(findings).toEqual([])
  })

  it('flags an expired file, which advertises a channel nobody watches', async () => {
    const findings = await run(securityTxtCheck, {
      probe: probeStub({ '/.well-known/security.txt': { status: 200, body: securityTxt(-30) } }),
    })
    expect(only(findings).title).toContain('expired')
    expect(only(findings).severity).toBe('medium')
  })

  it('flags a file with no Contact field', async () => {
    const findings = await run(securityTxtCheck, {
      probe: probeStub({
        '/.well-known/security.txt': {
          status: 200,
          body: `Expires: ${new Date(Date.now() + 86_400_000).toISOString()}\n`,
        },
      }),
    })
    expect(titles(findings)).toContain('security.txt has no Contact address')
  })

  it('flags the catch-all route serving the app shell with a 200', async () => {
    const findings = await run(securityTxtCheck, {
      probe: probeStub({
        '/.well-known/security.txt': { status: 200, body: '<!doctype html><html><body>App</body></html>' },
      }),
    })
    expect(only(findings).title).toBe('security.txt path returns an HTML page')
  })
})

describe('security.email.spf', () => {
  it('stays silent when the mail domain could not be derived', async () => {
    // blog.example.com may inherit its parent's records; we never queried it.
    expect(await run(spfCheck, { url: 'https://blog.example.com/', dns: { emailDomain: null } })).toEqual([])
  })

  it('flags a domain with no SPF record', async () => {
    const findings = await run(spfCheck, { dns: { emailDomain: 'site.test', spfTxt: [] } })
    expect(only(findings).title).toBe('No SPF record')
    expect(only(findings).severity).toBe('medium')
  })

  it('stays silent when the TXT lookup failed rather than answered', async () => {
    // A resolver timeout is not evidence of absence — github.com publishes SPF.
    expect(await run(spfCheck, { dns: { emailDomain: 'site.test', spfTxt: 'unknown' } })).toEqual([])
  })

  it('ignores unrelated TXT records when deciding SPF is absent', async () => {
    const findings = await run(spfCheck, {
      dns: { emailDomain: 'site.test', spfTxt: ['google-site-verification=abc123'] },
    })
    expect(only(findings).title).toBe('No SPF record')
  })

  it('never reports ~all — softfail is a considered production choice', async () => {
    const findings = await run(spfCheck, {
      dns: { emailDomain: 'site.test', spfTxt: ['v=spf1 include:_spf.google.com ~all'] },
    })
    expect(findings).toEqual([])
  })

  it('accepts a strict -all record', async () => {
    const findings = await run(spfCheck, { dns: { emailDomain: 'site.test', spfTxt: ['v=spf1 -all'] } })
    expect(findings).toEqual([])
  })

  it('flags +all, which authorises the whole internet to spoof the domain', async () => {
    const findings = await run(spfCheck, {
      dns: { emailDomain: 'site.test', spfTxt: ['v=spf1 include:_spf.google.com +all'] },
    })
    expect(only(findings).severity).toBe('high')
  })

  it('flags two SPF records, which receivers treat as no record at all', async () => {
    const findings = await run(spfCheck, {
      dns: {
        emailDomain: 'site.test',
        spfTxt: ['v=spf1 include:a.test ~all', 'v=spf1 include:b.test ~all'],
      },
    })
    expect(only(findings).title).toBe('Multiple SPF records')
  })

  it('flags a record whose own terms already breach the 10-lookup limit', async () => {
    const includes = Array.from({ length: 12 }, (_, i) => `include:s${i}.test`).join(' ')
    const findings = await run(spfCheck, {
      dns: { emailDomain: 'site.test', spfTxt: [`v=spf1 ${includes} ~all`] },
    })
    expect(titles(findings)).toContain('SPF record exceeds the 10-lookup limit')
  })

  it('does not count ip4/ip6 terms towards the lookup limit', async () => {
    const ips = Array.from({ length: 20 }, (_, i) => `ip4:203.0.113.${i}`).join(' ')
    const findings = await run(spfCheck, {
      dns: { emailDomain: 'site.test', spfTxt: [`v=spf1 ${ips} ~all`] },
    })
    expect(findings).toEqual([])
  })
})

describe('security.email.dmarc', () => {
  it('stays silent when the mail domain could not be derived', async () => {
    expect(await run(dmarcCheck, { url: 'https://blog.example.com/', dns: { emailDomain: null } })).toEqual([])
  })

  it('flags a domain with no DMARC record', async () => {
    const findings = await run(dmarcCheck, { dns: { emailDomain: 'site.test', dmarcTxt: [] } })
    expect(only(findings).title).toBe('No DMARC record')
    expect(only(findings).severity).toBe('medium')
  })

  it('stays silent when the _dmarc lookup failed rather than answered', async () => {
    expect(await run(dmarcCheck, { dns: { emailDomain: 'site.test', dmarcTxt: 'unknown' } })).toEqual([])
  })

  it('accepts an enforcing record with a reporting address', async () => {
    const findings = await run(dmarcCheck, {
      dns: {
        emailDomain: 'site.test',
        dmarcTxt: ['v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@site.test'],
      },
    })
    expect(findings).toEqual([])
  })

  it('treats p=none as an improvement opportunity, not a defect', async () => {
    const findings = await run(dmarcCheck, {
      dns: { emailDomain: 'site.test', dmarcTxt: ['v=DMARC1; p=none; rua=mailto:d@site.test'] },
    })
    expect(only(findings).title).toBe('DMARC policy is monitor-only (p=none)')
    expect(only(findings).severity).toBe('low')
  })

  it('flags an enforcing policy with no rua, which leaves the owner blind', async () => {
    const findings = await run(dmarcCheck, {
      dns: { emailDomain: 'site.test', dmarcTxt: ['v=DMARC1; p=reject'] },
    })
    expect(titles(findings)).toContain('DMARC record has no rua= reporting address')
  })

  it('flags sp=none, which exempts every subdomain from an enforcing policy', async () => {
    const findings = await run(dmarcCheck, {
      dns: {
        emailDomain: 'site.test',
        dmarcTxt: ['v=DMARC1; p=reject; sp=none; rua=mailto:d@site.test'],
      },
    })
    expect(titles(findings)).toContain('Subdomains are exempt from the DMARC policy (sp=none)')
  })

  it('flags two records, which RFC 7489 treats as none', async () => {
    const findings = await run(dmarcCheck, {
      dns: {
        emailDomain: 'site.test',
        dmarcTxt: ['v=DMARC1; p=reject; rua=mailto:d@site.test', 'v=DMARC1; p=none'],
      },
    })
    expect(only(findings).title).toBe('Multiple DMARC records published')
  })

  it('ignores unrelated TXT records at _dmarc', async () => {
    const findings = await run(dmarcCheck, {
      dns: { emailDomain: 'site.test', dmarcTxt: ['some-verification-token=xyz'] },
    })
    expect(only(findings).title).toBe('No DMARC record')
  })
})

const SEVERITY_RANK: Record<Finding['severity'], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}
