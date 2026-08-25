/**
 * Domain-level checks: who may issue certificates for this name (CAA), how
 * long the name is still theirs (registration expiry), and whether the domain
 * publishes DKIM keys.
 *
 * These three share one failure mode and it is the reason most of the cases
 * below assert SILENCE: each of them can only see part of the truth. CAA is
 * inherited from ancestors, registration data is withheld by many registries,
 * and DKIM selectors cannot be enumerated at all. A check that treats "I could
 * not see it" as "it is not there" is a check that tells correctly configured
 * customers they are broken.
 */

import { describe, expect, it } from 'vitest'
import { caaCheck } from '../src/domain/caa.ts'
import { domainExpiryCheck } from '../src/domain/expiry.ts'
import { dkimCheck } from '../src/email/dkim.ts'
import type { CheckContext, Finding } from '../src/types.ts'
import { makeContext, tlsExpiringIn } from './helpers.ts'

const run = async (check: { run: (ctx: CheckContext) => Promise<Finding[]> | Finding[] }, ctx: CheckContext) =>
  await check.run(ctx)

/** Registration expiring `days` from now — never a literal date, so tests cannot rot. */
const expiringIn = (days: number, registrar: string | null = 'Test Registrar') => ({
  expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
  registrar,
})

describe('security.domain.caa', () => {
  it('stays silent when the tree climb could not be completed', async () => {
    // null is the context saying "a resolver failed somewhere up the chain".
    // The policy we would report on may live at the name we failed to read.
    expect(await run(caaCheck, makeContext({ dns: { caa: null } }))).toEqual([])
  })

  it('flags a domain where no ancestor publishes CAA', async () => {
    const findings = await run(caaCheck, makeContext({ dns: { caa: { name: 'site.test', records: [] } } }))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('low')
    expect(findings[0]?.title).toBe('No CAA record')
  })

  it('stays silent when a CA is authorized', async () => {
    const ctx = makeContext({ dns: { caa: { name: 'site.test', records: ['issue "letsencrypt.org"'] } } })
    expect(await run(caaCheck, ctx)).toEqual([])
  })

  it('stays silent for a set inherited from a parent name', async () => {
    // www.site.test has no CAA of its own; site.test's set is what binds a CA.
    // Reporting "no CAA" here is the single most likely false positive in this
    // check, and it is what a one-shot DNS query would produce.
    const ctx = makeContext({
      url: 'https://www.site.test/',
      dns: { caa: { name: 'site.test', records: ['issue "pki.goog"'] } },
    })
    expect(await run(caaCheck, ctx)).toEqual([])
  })

  it('reads the issuer out of a record carrying CA parameters', async () => {
    const ctx = makeContext({
      dns: { caa: { name: 'site.test', records: ['issue "sectigo.com; account=12345; policy=ev"'] } },
    })
    expect(await run(caaCheck, ctx)).toEqual([])
  })

  it('stays silent when only wildcard issuance is forbidden', async () => {
    // issue authorizes, issuewild ";" bans wildcards. That is deliberate
    // hardening, and flagging it would punish the careful configuration.
    const ctx = makeContext({
      dns: { caa: { name: 'site.test', records: ['issue "letsencrypt.org"', 'issuewild ";"'] } },
    })
    expect(await run(caaCheck, ctx)).toEqual([])
  })

  it('flags a set that authorizes nobody, harder when a certificate is live', async () => {
    const records = ['iodef "mailto:security@site.test"']
    const withCert = await run(caaCheck, makeContext({ dns: { caa: { name: 'site.test', records } }, tls: tlsExpiringIn(60) }))
    expect(withCert[0]?.severity).toBe('high')
    expect(withCert[0]?.title).toBe('CAA record forbids all certificate issuance')

    const withoutCert = await run(caaCheck, makeContext({ dns: { caa: { name: 'site.test', records } }, tls: null }))
    expect(withoutCert[0]?.severity).toBe('medium')
  })

  it('flags a set whose every issue property names the empty issuer', async () => {
    const ctx = makeContext({ dns: { caa: { name: 'site.test', records: ['issue ";"', 'issuewild ";"'] } } })
    const findings = await run(caaCheck, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.checkId).toBe('security.domain.caa')
  })

  it('stays silent on a record set it could not parse', async () => {
    // Not "issuance is blocked" — we simply failed to read the set, and that
    // is far too loud a claim to make off a parse failure.
    const ctx = makeContext({ dns: { caa: { name: 'site.test', records: ['\\u0000\\u0001garbage'] } } })
    expect(await run(caaCheck, ctx)).toEqual([])
  })
})

describe('security.domain.expiry', () => {
  it('stays silent when the registry answered nothing', async () => {
    expect(await run(domainExpiryCheck, makeContext({ dns: { registration: null } }))).toEqual([])
  })

  it('stays silent when the registry withheld the date', async () => {
    const ctx = makeContext({ dns: { registration: { expiresAt: null, registrar: 'Some Registrar' } } })
    expect(await run(domainExpiryCheck, ctx)).toEqual([])
  })

  it('stays silent on a date it cannot parse', async () => {
    const ctx = makeContext({ dns: { registration: { expiresAt: 'not a date', registrar: null } } })
    expect(await run(domainExpiryCheck, ctx)).toEqual([])
  })

  it('stays silent on a registration renewed well in advance', async () => {
    expect(await run(domainExpiryCheck, makeContext({ dns: { registration: expiringIn(365) } }))).toEqual([])
    // Both sides of the 30-day boundary. Half-days on purpose: an exact 31
    // would floor to 30 the moment a millisecond elapses between building the
    // fixture and the check reading the clock, which is a flaky test, not a
    // boundary test.
    expect(await run(domainExpiryCheck, makeContext({ dns: { registration: expiringIn(30.5) } }))).toHaveLength(1)
    expect(await run(domainExpiryCheck, makeContext({ dns: { registration: expiringIn(31.5) } }))).toEqual([])
  })

  it('scales severity with how little time is left', async () => {
    const severityAt = async (days: number) =>
      (await run(domainExpiryCheck, makeContext({ dns: { registration: expiringIn(days) } })))[0]?.severity

    expect(await severityAt(25)).toBe('medium')
    expect(await severityAt(7)).toBe('high')
    expect(await severityAt(1)).toBe('high')
    expect(await severityAt(-3)).toBe('critical')
  })

  it('names the registrar in the evidence and the fix prompt', async () => {
    const findings = await run(domainExpiryCheck, makeContext({ dns: { registration: expiringIn(10, 'Acme Domains') } }))
    expect(findings[0]?.evidence).toMatchObject({ registrar: 'Acme Domains', daysLeft: 10, source: 'RDAP' })
    expect(findings[0]?.fixPrompt).toContain('Acme Domains')
  })

  it('omits the registrar cleanly when the registry withheld it', async () => {
    const findings = await run(domainExpiryCheck, makeContext({ dns: { registration: expiringIn(10, null) } }))
    expect(findings[0]?.remediation).not.toContain('null')
    expect(findings[0]?.fixPrompt).not.toContain('null')
  })
})

const LIVE_KEY = 'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC4T1PE2vh5xqRGzOrDnkoi'
const REVOKED = 'v=DKIM1; p='

/** A zone that sends mail — the gate on the "no selector found" note. */
const SENDS_MAIL = { mx: ['aspmx.l.google.com'], spfTxt: ['v=spf1 include:_spf.google.com ~all'] }

describe('security.email.dkim', () => {
  it('stays silent when no organizational domain could be derived', async () => {
    const ctx = makeContext({ url: 'https://deep.sub.site.test/', dns: { emailDomain: null, ...SENDS_MAIL } })
    expect(await run(dkimCheck, ctx)).toEqual([])
  })

  it('stays silent when a live key is published', async () => {
    const ctx = makeContext({
      dns: { ...SENDS_MAIL, dkim: { selectors: { google: [LIVE_KEY] }, wildcard: null } },
    })
    expect(await run(dkimCheck, ctx)).toEqual([])
  })

  it('treats a revoke-everything wildcard as the deliberate statement it is', async () => {
    // example.com publishes *._domainkey = "v=DKIM1; p=" — RFC 6376 §3.6.1 for
    // "this domain signs nothing". It is a correct configuration, not a defect.
    const ctx = makeContext({ dns: { dkim: { selectors: {}, wildcard: [REVOKED] } } })
    expect(await run(dkimCheck, ctx)).toEqual([])
  })

  it('flags a wildcard that serves a usable key for every selector', async () => {
    const ctx = makeContext({ dns: { ...SENDS_MAIL, dkim: { selectors: {}, wildcard: [LIVE_KEY] } } })
    const findings = await run(dkimCheck, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('low')
    expect(findings[0]?.title).toContain('wildcard')
  })

  it('notes an unfindable key only for a domain that actually handles mail', async () => {
    const quiet = makeContext({ dns: { emailDomain: 'site.test', mx: [], spfTxt: [], dmarcTxt: [] } })
    expect(await run(dkimCheck, quiet)).toEqual([])

    const viaMx = await run(dkimCheck, makeContext({ dns: { mx: ['mx.site.test'] } }))
    expect(viaMx).toHaveLength(1)
    expect(viaMx[0]?.severity).toBe('info')

    const viaSpf = await run(dkimCheck, makeContext({ dns: { spfTxt: ['v=spf1 -all'] } }))
    expect(viaSpf).toHaveLength(1)
  })

  it('never claims DKIM is absent — only that no known selector answered', async () => {
    // The wording IS the contract here: selectors cannot be enumerated, so a
    // report that says "no DKIM" is making a claim it cannot support.
    const findings = await run(dkimCheck, makeContext({ dns: SENDS_MAIL }))
    expect(findings[0]?.severity).toBe('info') // zero score impact, by design
    expect(findings[0]?.description).toContain('NOT proof')
    expect(findings[0]?.title).toContain('well-known selector')
  })

  it('flags a domain whose every published key is revoked', async () => {
    const ctx = makeContext({
      dns: { ...SENDS_MAIL, dkim: { selectors: { google: [REVOKED], s1: [REVOKED] }, wildcard: null } },
    })
    const findings = await run(dkimCheck, ctx)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('medium')
    expect(findings[0]?.title).toBe('Every DKIM key found is revoked')
  })

  it('ignores retired selectors while a live one remains', async () => {
    // Old keys are left published for months after a rotation. That is normal
    // operations, not a defect, and flagging it would fire on healthy domains.
    const ctx = makeContext({
      dns: { ...SENDS_MAIL, dkim: { selectors: { k1: [REVOKED], google: [LIVE_KEY] }, wildcard: null } },
    })
    expect(await run(dkimCheck, ctx)).toEqual([])
  })

  it('flags a live selector still in test mode, including within a flag list', async () => {
    const single = await run(
      dkimCheck,
      makeContext({ dns: { ...SENDS_MAIL, dkim: { selectors: { google: [`${LIVE_KEY}; t=y`] }, wildcard: null } } }),
    )
    expect(single).toHaveLength(1)
    expect(single[0]?.severity).toBe('low')

    // t= is a colon-separated flag list; "s:y" carries the test flag too.
    const inList = await run(
      dkimCheck,
      makeContext({ dns: { ...SENDS_MAIL, dkim: { selectors: { google: [`${LIVE_KEY}; t=s:y`] }, wildcard: null } } }),
    )
    expect(inList).toHaveLength(1)
  })

  it('does not mistake the strict-subdomain flag for test mode', async () => {
    const ctx = makeContext({
      dns: { ...SENDS_MAIL, dkim: { selectors: { google: [`${LIVE_KEY}; t=s`] }, wildcard: null } },
    })
    expect(await run(dkimCheck, ctx)).toEqual([])
  })
})
