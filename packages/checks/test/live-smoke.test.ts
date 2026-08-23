/**
 * Live end-to-end smoke test — the Phase 0 "done when": scan a real site,
 * correctly, in seconds. Network tests are flaky by nature, so this runs only
 * when explicitly requested:
 *
 *   DARVIN_LIVE=1 pnpm test
 *
 * example.com is the target: tiny, stable, and famously bare of security
 * headers, so we can assert real findings without depending on anyone's
 * deploy schedule.
 */

import { describe, expect, it } from 'vitest'
import { buildContext } from '../src/context/build-context.ts'
import { allChecks, runChecks } from '../src/registry.ts'
import { computeScores } from '../src/scoring.ts'

describe.skipIf(process.env.DARVIN_LIVE !== '1')('live smoke (DARVIN_LIVE=1)', () => {
  it('scans example.com end-to-end within the Phase 0 budget', async () => {
    const startedAt = Date.now()
    const ctx = await buildContext('https://example.com')
    const { findings, errors } = await runChecks(ctx)
    const elapsed = Date.now() - startedAt

    expect(ctx.status).toBe(200)
    expect(errors).toEqual([])
    // example.com ships no CSP/HSTS — a clean report here would mean we broke.
    expect(findings.map((f) => f.checkId)).toContain('security.headers.csp')

    const scores = computeScores(findings, allChecks, errors)
    expect(scores.security).toBeLessThan(100)
    expect(scores.security).toBeGreaterThan(0)

    expect(elapsed).toBeLessThan(10_000)
  }, 20_000)

  it('refuses to scan private targets end-to-end', async () => {
    await expect(buildContext('http://127.0.0.1/')).rejects.toThrow(/refus/i)
    await expect(buildContext('http://localhost:3000/')).rejects.toThrow()
    await expect(buildContext('http://169.254.169.254/latest/meta-data/')).rejects.toThrow()
  })
})
