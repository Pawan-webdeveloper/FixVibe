/**
 * Fixture tests: recorded (plus synthetic) site profiles run through the
 * registry, asserting which checks fire and which stay silent. This is the
 * regression net for real-world behaviour — when a check's logic changes,
 * these tests say what that means for actual sites.
 *
 * Each fixture declares the `categories` its recording actually captured, and
 * only those checks run. A snapshot that recorded headers and TLS but no page
 * HTML cannot honestly be judged by the SEO checks — running them anyway would
 * assert on data that was never observed.
 *
 * Certificate dates are stored as day-offsets from "now" so fixtures never
 * expire under us.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { allChecks, runChecks } from '../src/registry.ts'
import type { Category } from '../src/types.ts'
import { makeContext, probeStub, robotsFrom } from './helpers.ts'

interface Fixture {
  name: string
  /** Which pillars this recording has data for — checks outside them are skipped. */
  categories: Category[]
  url: string
  finalUrl: string
  redirectChain?: string[]
  status: number
  headers: Record<string, string>
  html?: string
  /** robots.txt body; null/absent means the file was missing or non-200. */
  robotsTxt?: string | null
  /** Same-origin paths a check may probe, and what they answered. */
  probe?: Record<string, { status: number; body?: string }>
  tls: { daysFromNow: number; protocol: string; issuer: string } | null
  httpProbe: { status: number; location: string | null } | null
  expect: { clean?: boolean; mustFlag: string[]; mustNotFlag: string[] }
}

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url))
const fixtures = readdirSync(fixturesDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as Fixture)

describe('site fixtures through the registry', () => {
  it('has the recorded fixture sites', () => {
    expect(fixtures.length).toBe(6)
  })

  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_, fixture) => {
    const ctx = makeContext({
      url: fixture.url,
      finalUrl: fixture.finalUrl,
      redirectChain: fixture.redirectChain ?? [],
      status: fixture.status,
      headers: fixture.headers,
      html: fixture.html,
      robots: fixture.robotsTxt ? robotsFrom(fixture.robotsTxt) : null,
      probe: probeStub(fixture.probe ?? {}),
      tls: fixture.tls
        ? {
            validTo: new Date(Date.now() + fixture.tls.daysFromNow * 86_400_000),
            protocol: fixture.tls.protocol,
            issuer: fixture.tls.issuer,
          }
        : null,
      httpProbe: fixture.httpProbe,
    })

    const checks = allChecks.filter((check) => fixture.categories.includes(check.category))
    expect(checks.length, `${fixture.name} declares categories no check covers`).toBeGreaterThan(0)

    const { findings, errors } = await runChecks(ctx, checks)
    expect(errors).toEqual([])

    const flagged = new Set(findings.map((f) => f.checkId))
    for (const id of fixture.expect.mustFlag) expect(flagged, `expected ${id} to fire`).toContain(id)
    for (const id of fixture.expect.mustNotFlag) expect(flagged, `expected ${id} to stay silent`).not.toContain(id)
    if (fixture.expect.clean) expect(findings).toEqual([])
  })
})
