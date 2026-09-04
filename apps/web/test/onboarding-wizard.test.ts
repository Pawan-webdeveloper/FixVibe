/**
 * apps/web/test/onboarding-wizard.test.ts
 *
 * The wizard is mostly a presentation layer, but it does own three
 * small bits of pure logic worth covering:
 *
 *   - The tone mapping per check (uptime/SSL/domain/vitals → green/
 *     amber/red) — these thresholds are not in the spec, so a
 *     regression here would silently change the scorecard without
 *     anyone noticing.
 *   - The scorecard aggregation (any red → "needs attention", any
 *     amber → "watch the amber", all green → "everything is green").
 *     Same reason: a regression in the verdict shape would change
 *     what the wizard says to every new user.
 *
 * The components themselves are exercised by hand on the running
 * server. These tests are about the parts a regression in the spec
 * would actually break — the parts that decide whether a row shows
 * a checkmark or a warning.
 *
 * We import the component module to reach the helpers. Vitest is
 * configured with jsx parsing on `test/` so the file resolves
 * without an additional step.
 */

import { describe, expect, it } from 'vitest'
import {
  buildRows,
  type OnboardingCheckPayload,
  overallVerdict,
} from '@/components/onboarding/onboarding-checks-logic.ts'

function makePayload(overrides: Partial<OnboardingCheckPayload> = {}): OnboardingCheckPayload {
  return {
    url: 'https://example.com',
    hostname: 'example.com',
    uptime: { status: 'up', latencyMs: 145, statusCode: 200, detail: null },
    ssl: { ok: true, daysUntilExpiry: 45, expiresAt: '2027-01-01T00:00:00Z', detail: null },
    domain: { ok: true, daysUntilExpiry: 600, expiresAt: '2027-01-01T00:00:00Z', detail: null },
    webVitals: { ok: true, lcp: 1.8, cls: 0.02, detail: null },
    ...overrides,
  }
}

describe('onboarding check row tone', () => {
  it('marks uptime up + low latency as green', () => {
    const rows = buildRows(makePayload(), { uptime: false, ssl: false, domain: false, vitals: false })
    const uptime = rows.find((r) => r.key === 'uptime')
    expect(uptime?.status).toBe('green')
    expect(uptime?.headline).toBe('UP — 145ms')
  })

  it('marks uptime down as red', () => {
    const rows = buildRows(
      makePayload({ uptime: { status: 'down', latencyMs: null, statusCode: 503, detail: null } }),
      { uptime: false, ssl: false, domain: false, vitals: false },
    )
    expect(rows.find((r) => r.key === 'uptime')?.status).toBe('red')
  })

  it('marks uptime timeout as amber, not red', () => {
    // A timeout is "we couldn't tell" — it's worse than green but
    // not the same as "the site explicitly returned 503". Treating
    // a transient network glitch as red would alarm the user for
    // a check that may already be back to green on retry.
    const rows = buildRows(
      makePayload({ uptime: { status: 'timeout', latencyMs: null, statusCode: null, detail: null } }),
      { uptime: false, ssl: false, domain: false, vitals: false },
    )
    expect(rows.find((r) => r.key === 'uptime')?.status).toBe('amber')
  })

  it('flags an SSL cert inside 14 days as red, 14–30 as amber, 30+ as green', () => {
    const red = buildRows(
      makePayload({ ssl: { ok: true, daysUntilExpiry: 7, expiresAt: null, detail: null } }),
      { uptime: false, ssl: false, domain: false, vitals: false },
    )
    const amber = buildRows(
      makePayload({ ssl: { ok: true, daysUntilExpiry: 21, expiresAt: null, detail: null } }),
      { uptime: false, ssl: false, domain: false, vitals: false },
    )
    const green = buildRows(
      makePayload({ ssl: { ok: true, daysUntilExpiry: 45, expiresAt: null, detail: null } }),
      { uptime: false, ssl: false, domain: false, vitals: false },
    )
    expect(red.find((r) => r.key === 'ssl')?.status).toBe('red')
    expect(amber.find((r) => r.key === 'ssl')?.status).toBe('amber')
    expect(green.find((r) => r.key === 'ssl')?.status).toBe('green')
  })

  it('flags domain expiry inside 30 days as red, 30–90 as amber, 90+ as green', () => {
    const red = buildRows(
      makePayload({ domain: { ok: true, daysUntilExpiry: 14, expiresAt: null, detail: null } }),
      { uptime: false, ssl: false, domain: false, vitals: false },
    )
    const amber = buildRows(
      makePayload({ domain: { ok: true, daysUntilExpiry: 60, expiresAt: null, detail: null } }),
      { uptime: false, ssl: false, domain: false, vitals: false },
    )
    const green = buildRows(
      makePayload({ domain: { ok: true, daysUntilExpiry: 400, expiresAt: null, detail: null } }),
      { uptime: false, ssl: false, domain: false, vitals: false },
    )
    expect(red.find((r) => r.key === 'domain')?.status).toBe('red')
    expect(amber.find((r) => r.key === 'domain')?.status).toBe('amber')
    expect(green.find((r) => r.key === 'domain')?.status).toBe('green')
  })

  it('marks LCP above 4s as red, between 2.5–4s as amber, below as green', () => {
    const red = buildRows(
      makePayload({ webVitals: { ok: true, lcp: 4.5, cls: 0.05, detail: null } }),
      { uptime: false, ssl: false, domain: false, vitals: false },
    )
    const amber = buildRows(
      makePayload({ webVitals: { ok: true, lcp: 3.0, cls: 0.05, detail: null } }),
      { uptime: false, ssl: false, domain: false, vitals: false },
    )
    const green = buildRows(
      makePayload({ webVitals: { ok: true, lcp: 1.8, cls: 0.02, detail: null } }),
      { uptime: false, ssl: false, domain: false, vitals: false },
    )
    expect(red.find((r) => r.key === 'vitals')?.status).toBe('red')
    expect(amber.find((r) => r.key === 'vitals')?.status).toBe('amber')
    expect(green.find((r) => r.key === 'vitals')?.status).toBe('green')
  })

  it('keeps a pending row as pending even after the payload has arrived', () => {
    // buildRows is pure over (payload, pending). The component owns
    // the staggered reveal — the function just reflects state.
    const rows = buildRows(makePayload(), { uptime: false, ssl: true, domain: true, vitals: true })
    expect(rows.find((r) => r.key === 'uptime')?.status).toBe('green')
    expect(rows.find((r) => r.key === 'ssl')?.status).toBe('pending')
  })
})

describe('onboarding scorecard aggregation', () => {
  it('returns the all-green verdict when no row is red or amber', () => {
    const rows = buildRows(makePayload(), { uptime: false, ssl: false, domain: false, vitals: false })
    const verdict = overallVerdict(rows)
    expect(verdict.tone).toBe('green')
    expect(verdict.headline).toMatch(/green/i)
  })

  it('surfaces any red row in the headline', () => {
    const rows = buildRows(
      makePayload({ uptime: { status: 'down', latencyMs: null, statusCode: 503, detail: null } }),
      { uptime: false, ssl: false, domain: false, vitals: false },
    )
    const verdict = overallVerdict(rows)
    expect(verdict.tone).toBe('red')
    expect(verdict.headline).toMatch(/1 thing/i)
  })

  it('surfaces amber-only rows as "watch the amber"', () => {
    const rows = buildRows(
      makePayload({ ssl: { ok: true, daysUntilExpiry: 21, expiresAt: null, detail: null } }),
      { uptime: false, ssl: false, domain: false, vitals: false },
    )
    const verdict = overallVerdict(rows)
    expect(verdict.tone).toBe('amber')
    expect(verdict.headline).toMatch(/amber/i)
  })

  it('returns a probing placeholder when no row has resolved', () => {
    const rows = buildRows(null, { uptime: true, ssl: true, domain: true, vitals: true })
    const verdict = overallVerdict(rows)
    expect(verdict.tone).toBe('mixed')
    expect(verdict.headline).toMatch(/probing/i)
  })
})
