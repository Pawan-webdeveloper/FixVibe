/**
 * Runner guarantees: one broken check must never sink a scan, and output
 * order must be deterministic. These are the engine's reliability contract —
 * the web app will stream this output to paying users unsupervised.
 */

import { describe, expect, it } from 'vitest'
import type { Check, Finding } from '../src/types.ts'
import { allChecks, runChecks } from '../src/registry.ts'
import {
  CLEAN_SEO_HTML,
  HEALTHY_DNS,
  makeContext,
  permissiveRobots,
  probeStub,
  LLMS_TXT,
  securityTxt,
  SITEMAP_XML,
} from './helpers.ts'

const finding = (checkId: string, severity: Finding['severity']): Finding => ({
  checkId,
  category: 'security',
  severity,
  title: checkId,
  description: 'synthetic',
  remediation: 'synthetic',
  fixPrompt: 'synthetic',
})

const emitting = (id: string, severity: Finding['severity']): Check => ({
  id,
  category: 'security',
  title: id,
  run: () => [finding(id, severity)],
})

describe('runChecks', () => {
  it('registers every check under a unique, category-prefixed id', () => {
    // All six pillars now carry checks, so `overall` finally averages the
    // whole report rather than the two thirds of it that were covered.
    expect(allChecks).toHaveLength(57)
    const perPillar = Object.fromEntries(
      ['security', 'seo', 'aeo', 'performance', 'accessibility', 'compliance'].map((pillar) => [
        pillar,
        allChecks.filter((c) => c.category === pillar).length,
      ]),
    )
    expect(perPillar).toEqual({
      security: 25,
      seo: 15,
      aeo: 8,
      performance: 3,
      accessibility: 3,
      compliance: 3,
    })

    // Stable dot-namespaced ids are DB keys later — catch accidental renames.
    expect(new Set(allChecks.map((c) => c.id)).size).toBe(allChecks.length)
    for (const check of allChecks) {
      expect(check.id, `${check.id} must be dot-namespaced lowercase`).toMatch(/^[a-z]+(\.[a-z0-9-]+)+$/)
      expect(check.id.startsWith(`${check.category}.`), `${check.id} must start with its category`).toBe(true)
    }
  })

  it('isolates a crashing check instead of failing the scan', async () => {
    const crashing: Check = {
      id: 'test.crash',
      category: 'security',
      title: 'crash',
      run: () => {
        throw new Error('boom')
      },
    }
    const { findings, errors } = await runChecks(makeContext(), [crashing, emitting('test.ok', 'low')])
    expect(findings.map((f) => f.checkId)).toEqual(['test.ok'])
    expect(errors).toEqual([{ checkId: 'test.crash', message: 'boom' }])
  })

  it('sorts findings worst-first, then by id for determinism', async () => {
    const { findings } = await runChecks(makeContext(), [
      emitting('test.b-low', 'low'),
      emitting('test.z-critical', 'critical'),
      emitting('test.a-low', 'low'),
      emitting('test.m-high', 'high'),
    ])
    expect(findings.map((f) => f.checkId)).toEqual(['test.z-critical', 'test.m-high', 'test.a-low', 'test.b-low'])
  })

  it('runs a clean scan with zero findings and zero errors', async () => {
    // A well-configured synthetic site: the full registry must stay silent.
    // This is the false-positive guard — every new check has to pass it.
    const ctx = makeContext({
      headers: {
        'content-security-policy': "default-src 'self'; script-src 'self'; frame-ancestors 'none'",
        'strict-transport-security': 'max-age=31536000; includeSubDomains',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': 'camera=(), microphone=()',
      },
      tls: { validTo: new Date(Date.now() + 60 * 86_400_000), protocol: 'TLSv1.3', issuer: 'Test CA' },
      httpProbe: { status: 301, location: 'https://site.test/' },
      html: CLEAN_SEO_HTML,
      robots: permissiveRobots(),
      dns: HEALTHY_DNS,
      probe: probeStub({
        '/sitemap.xml': { status: 200, body: SITEMAP_XML },
        '/.well-known/security.txt': { status: 200, body: securityTxt() },
        '/llms.txt': { status: 200, body: LLMS_TXT },
      }),
    })
    const { findings, errors } = await runChecks(ctx)
    expect(errors).toEqual([])
    expect(findings).toEqual([])
  })
})
