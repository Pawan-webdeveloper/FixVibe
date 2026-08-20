/**
 * Unit tests for the six security-header checks, on synthetic contexts.
 * Each block covers the three states that matter: missing, present-but-weak,
 * and correctly configured (which must stay silent — false positives are the
 * fastest way to lose a user's trust).
 */

import { describe, expect, it } from 'vitest'
import type { Check, Finding } from '../src/types.ts'
import { cspCheck } from '../src/security/headers/csp.ts'
import { hstsCheck } from '../src/security/headers/hsts.ts'
import { permissionsPolicyCheck } from '../src/security/headers/permissions-policy.ts'
import { referrerPolicyCheck } from '../src/security/headers/referrer-policy.ts'
import { xContentTypeOptionsCheck } from '../src/security/headers/x-content-type-options.ts'
import { xFrameOptionsCheck } from '../src/security/headers/x-frame-options.ts'
import { makeContext, type ContextOverrides } from './helpers.ts'

const run = async (check: Check, overrides: ContextOverrides = {}): Promise<Finding[]> =>
  check.run(makeContext(overrides))

describe('security.headers.csp', () => {
  it('flags a missing policy as high', async () => {
    const findings = await run(cspCheck)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('high')
  })

  it('flags report-only-only as medium', async () => {
    const findings = await run(cspCheck, {
      headers: { 'content-security-policy-report-only': "default-src 'self'" },
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('medium')
  })

  it('accepts a strict policy', async () => {
    const findings = await run(cspCheck, {
      headers: { 'content-security-policy': "default-src 'self'; script-src 'self'; object-src 'none'" },
    })
    expect(findings).toEqual([])
  })

  it("flags 'unsafe-inline' in script-src without a nonce", async () => {
    const findings = await run(cspCheck, {
      headers: { 'content-security-policy': "script-src 'self' 'unsafe-inline'" },
    })
    expect(findings.map((f) => f.severity)).toContain('medium')
  })

  it("ignores 'unsafe-inline' when a nonce neutralises it (spec behaviour)", async () => {
    const findings = await run(cspCheck, {
      headers: { 'content-security-policy': "script-src 'nonce-abc123' 'unsafe-inline'" },
    })
    expect(findings).toEqual([])
  })

  it("flags 'unsafe-eval' as low", async () => {
    const findings = await run(cspCheck, {
      headers: { 'content-security-policy': "script-src 'self' 'unsafe-eval'" },
    })
    expect(findings.map((f) => f.severity)).toContain('low')
  })

  it('flags a wildcard script-src', async () => {
    const findings = await run(cspCheck, {
      headers: { 'content-security-policy': 'script-src *' },
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('medium')
  })

  it('honours a <meta http-equiv> policy as enforcing', async () => {
    const findings = await run(cspCheck, {
      html: '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head><body></body></html>',
    })
    expect(findings).toEqual([])
  })

  // Two CSP headers arrive comma-joined through Headers.get(); browsers enforce
  // their intersection, so one strict policy vetoes a lax sibling.
  it('does not flag a lax policy that a stricter sibling policy vetoes (two CSP headers)', async () => {
    const findings = await run(cspCheck, {
      headers: { 'content-security-policy': "default-src 'self', style-src 'unsafe-inline'" },
    })
    expect(findings).toEqual([])
  })

  it('does not read a non-script directive of a second policy as a script wildcard', async () => {
    const findings = await run(cspCheck, {
      headers: { 'content-security-policy': "script-src 'self', img-src *" },
    })
    expect(findings).toEqual([])
  })

  it('flags a weakness only when every policy allows it', async () => {
    const findings = await run(cspCheck, {
      headers: { 'content-security-policy': "script-src 'unsafe-inline', default-src 'unsafe-inline' 'self'" },
    })
    expect(findings.map((f) => f.title)).toContain("CSP allows 'unsafe-inline' scripts")
  })
})

describe('security.headers.hsts', () => {
  it('is silent on plain-http pages (not its problem)', async () => {
    const findings = await run(hstsCheck, { url: 'http://site.test/', finalUrl: 'http://site.test/' })
    expect(findings).toEqual([])
  })

  it('flags a missing header as medium', async () => {
    const findings = await run(hstsCheck)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('medium')
  })

  it('flags max-age=0 (protection actively disabled)', async () => {
    const findings = await run(hstsCheck, { headers: { 'strict-transport-security': 'max-age=0' } })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('medium')
  })

  it('flags a short max-age as low', async () => {
    const findings = await run(hstsCheck, { headers: { 'strict-transport-security': 'max-age=86400' } })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('low')
  })

  it('accepts a year-long policy', async () => {
    const findings = await run(hstsCheck, {
      headers: { 'strict-transport-security': 'max-age=31536000; includeSubDomains' },
    })
    expect(findings).toEqual([])
  })
})

describe('security.headers.x-frame-options', () => {
  it('flags a page with no framing protection', async () => {
    const findings = await run(xFrameOptionsCheck)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('medium')
  })

  it('accepts DENY and SAMEORIGIN in any case', async () => {
    expect(await run(xFrameOptionsCheck, { headers: { 'x-frame-options': 'DENY' } })).toEqual([])
    expect(await run(xFrameOptionsCheck, { headers: { 'x-frame-options': 'sameorigin' } })).toEqual([])
  })

  it('flags values browsers ignore (ALLOWALL)', async () => {
    const findings = await run(xFrameOptionsCheck, { headers: { 'x-frame-options': 'ALLOWALL' } })
    expect(findings).toHaveLength(1)
  })

  it('treats CSP frame-ancestors as full coverage', async () => {
    const findings = await run(xFrameOptionsCheck, {
      headers: { 'content-security-policy': "frame-ancestors 'none'" },
    })
    expect(findings).toEqual([])
  })

  it('accepts identical duplicated values (server + framework both set it)', async () => {
    expect(await run(xFrameOptionsCheck, { headers: { 'x-frame-options': 'SAMEORIGIN, SAMEORIGIN' } })).toEqual([])
  })

  it('notes conflicting values as low — browsers fail closed, config is still wrong', async () => {
    const findings = await run(xFrameOptionsCheck, { headers: { 'x-frame-options': 'DENY, ALLOWALL' } })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('low')
  })

  it('ignores frame-ancestors delivered via <meta> (spec: header-only directive)', async () => {
    const findings = await run(xFrameOptionsCheck, {
      html: '<html><head><meta http-equiv="Content-Security-Policy" content="frame-ancestors \'none\'"></head><body></body></html>',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('medium')
  })
})

describe('security.headers.x-content-type-options', () => {
  it('flags a missing header as low', async () => {
    const findings = await run(xContentTypeOptionsCheck)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('low')
  })

  it('accepts nosniff case-insensitively', async () => {
    expect(await run(xContentTypeOptionsCheck, { headers: { 'x-content-type-options': 'NOSniff' } })).toEqual([])
  })

  it('flags any other value', async () => {
    const findings = await run(xContentTypeOptionsCheck, { headers: { 'x-content-type-options': 'none' } })
    expect(findings).toHaveLength(1)
  })
})

describe('security.headers.referrer-policy', () => {
  it('flags a missing header as low', async () => {
    const findings = await run(referrerPolicyCheck)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('low')
  })

  it('flags leaky policies as medium', async () => {
    const findings = await run(referrerPolicyCheck, { headers: { 'referrer-policy': 'unsafe-url' } })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('medium')
  })

  it('uses the last policy of a fallback list (spec behaviour)', async () => {
    const findings = await run(referrerPolicyCheck, {
      headers: { 'referrer-policy': 'no-referrer-when-downgrade, strict-origin-when-cross-origin' },
    })
    expect(findings).toEqual([])
  })

  it('accepts strict policies', async () => {
    expect(await run(referrerPolicyCheck, { headers: { 'referrer-policy': 'no-referrer' } })).toEqual([])
  })

  it('skips unrecognised trailing tokens when finding the effective policy (spec fallback)', async () => {
    const findings = await run(referrerPolicyCheck, {
      headers: { 'referrer-policy': 'unsafe-url, not-a-real-policy' },
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('medium') // the leaky unsafe-url is what browsers fall back to
  })

  it('flags a header with no recognised token at all as low', async () => {
    const findings = await run(referrerPolicyCheck, {
      headers: { 'referrer-policy': 'strict-origin-cross-origin' }, // common typo
    })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.title).toBe('Referrer-Policy value is not recognised')
  })
})

describe('security.headers.permissions-policy', () => {
  it('nudges (info) when absent', async () => {
    const findings = await run(permissionsPolicyCheck)
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('info')
  })

  it('is silent when any policy is set', async () => {
    expect(await run(permissionsPolicyCheck, { headers: { 'permissions-policy': 'camera=()' } })).toEqual([])
  })
})
