/**
 * Fixture tests: recorded (plus one synthetic) site profiles run through the
 * FULL registry, asserting which checks fire and which stay silent. This is
 * the regression net for real-world behaviour — when a check's logic changes,
 * these tests say what that means for actual sites.
 *
 * Certificate dates are stored as day-offsets from "now" so fixtures never
 * expire under us.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runChecks } from '../src/registry.ts'
import { makeContext } from './helpers.ts'

interface Fixture {
  name: string
  url: string
  finalUrl: string
  redirectChain?: string[]
  status: number
  headers: Record<string, string>
  tls: { daysFromNow: number; protocol: string; issuer: string } | null
  httpProbe: { status: number; location: string | null } | null
  expect: { clean?: boolean; mustFlag: string[]; mustNotFlag: string[] }
}

const fixturesDir = fileURLToPath(new URL('../fixtures', import.meta.url))
const fixtures = readdirSync(fixturesDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as Fixture)

describe('site fixtures through the full registry', () => {
  it('has the five Phase 0 fixture sites', () => {
    expect(fixtures.length).toBe(5)
  })

  it.each(fixtures.map((f) => [f.name, f] as const))('%s', async (_, fixture) => {
    const ctx = makeContext({
      url: fixture.url,
      finalUrl: fixture.finalUrl,
      redirectChain: fixture.redirectChain ?? [],
      status: fixture.status,
      headers: fixture.headers,
      tls: fixture.tls
        ? {
            validTo: new Date(Date.now() + fixture.tls.daysFromNow * 86_400_000),
            protocol: fixture.tls.protocol,
            issuer: fixture.tls.issuer,
          }
        : null,
      httpProbe: fixture.httpProbe,
    })

    const { findings, errors } = await runChecks(ctx)
    expect(errors).toEqual([])

    const flagged = new Set(findings.map((f) => f.checkId))
    for (const id of fixture.expect.mustFlag) expect(flagged, `expected ${id} to fire`).toContain(id)
    for (const id of fixture.expect.mustNotFlag) expect(flagged, `expected ${id} to stay silent`).not.toContain(id)
    if (fixture.expect.clean) expect(findings).toEqual([])
  })
})
