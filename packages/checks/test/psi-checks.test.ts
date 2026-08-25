/**
 * Core Web Vitals, and the summariser that feeds it.
 *
 * The governing rule here is the sourcing one: a field measurement is what
 * real users experienced, a lab measurement is a simulation, and the check
 * must never present the second as the first. Most sites have no field data
 * at all, so the fallback path is the common one — and every finding it
 * produces has to lead with what the number is not.
 *
 * The other theme is that "we did not measure" and "we measured something
 * bad" are different states. No API key, spent quota, a URL Google refused, a
 * fast scan: all of those arrive as null, and null must produce silence.
 */

import { describe, expect, it } from 'vitest'
import { coreWebVitalsCheck } from '../src/performance/psi.ts'
import type { CheckContext, PageSpeedSummary } from '../src/types.ts'
import { makeContext } from './helpers.ts'

const psi = (overrides: Partial<PageSpeedSummary> = {}): PageSpeedSummary => ({
  strategy: 'mobile',
  labScore: 50,
  field: null,
  lab: null,
  ...overrides,
})

const field = (overrides: Partial<NonNullable<PageSpeedSummary['field']>> = {}) => ({
  lcpMs: 1800,
  inpMs: 120,
  cls: 0.03,
  scope: 'url' as const,
  ...overrides,
})

const withPsi = (summary: PageSpeedSummary | null): CheckContext => {
  const ctx = makeContext()
  return { ...ctx, pageSpeed: summary }
}

const run = (summary: PageSpeedSummary | null) => coreWebVitalsCheck.run(withPsi(summary))

describe('performance.core-web-vitals', () => {
  it('says nothing when the scan never measured', async () => {
    // A fast scan has no pageSpeed at all; a deep one without an API key has null.
    expect(await coreWebVitalsCheck.run(makeContext())).toEqual([])
    expect(await run(null)).toEqual([])
  })

  it('says nothing when a run produced neither field nor lab data', async () => {
    expect(await run(psi())).toEqual([])
  })

  it('stays silent when every real-user metric is good', async () => {
    expect(await run(psi({ field: field() }))).toEqual([])
  })

  it('is silent exactly at each threshold and speaks one step past it', async () => {
    // Google's boundaries are inclusive on "good"; a site sitting precisely on
    // 2500 ms passes in Search Console and must pass here.
    expect(await run(psi({ field: field({ lcpMs: 2500 }) }))).toEqual([])
    expect(await run(psi({ field: field({ inpMs: 200 }) }))).toEqual([])
    expect(await run(psi({ field: field({ cls: 0.1 }) }))).toEqual([])

    expect(await run(psi({ field: field({ lcpMs: 2501 }) }))).toHaveLength(1)
    expect(await run(psi({ field: field({ inpMs: 201 }) }))).toHaveLength(1)
    expect(await run(psi({ field: field({ cls: 0.101 }) }))).toHaveLength(1)
  })

  it('separates needs-improvement from poor', async () => {
    const severityOf = async (overrides: Partial<NonNullable<PageSpeedSummary['field']>>) =>
      (await run(psi({ field: field(overrides) })))[0]?.severity

    expect(await severityOf({ lcpMs: 3000 })).toBe('medium')
    expect(await severityOf({ lcpMs: 5000 })).toBe('high')
    expect(await severityOf({ inpMs: 300 })).toBe('medium')
    expect(await severityOf({ inpMs: 900 })).toBe('high')
    // CLS is rated below the two timing metrics: it is the least likely of the
    // three to be the reason someone leaves.
    expect(await severityOf({ cls: 0.2 })).toBe('low')
    expect(await severityOf({ cls: 0.4 })).toBe('medium')
  })

  it('reports each failing metric separately, because each has its own fix', async () => {
    const findings = await run(psi({ field: field({ lcpMs: 5000, inpMs: 800, cls: 0.4 }) }))
    expect(findings).toHaveLength(3)
    expect(findings.map((finding) => (finding.evidence as { metric: string }).metric)).toEqual(['LCP', 'INP', 'CLS'])
    // The fixes must not be interchangeable boilerplate.
    expect(findings[0]?.fixPrompt).toContain('lazy-loaded')
    expect(findings[1]?.fixPrompt).toContain('scheduler.yield')
    expect(findings[2]?.fixPrompt).toContain('aspect-ratio')
  })

  it('says so when the numbers describe the origin rather than this page', async () => {
    // origin_fallback means this URL had too little traffic and Google
    // substituted site-wide data. Claiming it measured this page would be a
    // lie about the only measurement in the whole report.
    const findings = await run(psi({ field: field({ lcpMs: 5000, scope: 'origin' }) }))
    expect(findings[0]?.description).toContain('too little traffic')
    expect(findings[0]?.evidence).toMatchObject({ source: 'CrUX field data (origin-level, 75th percentile)' })
  })

  it('ignores a metric the field report omits', async () => {
    // INP is missing for browsers that never reported it. Absent is unknown.
    const findings = await run(psi({ field: field({ inpMs: null, lcpMs: 5000 }) }))
    expect(findings).toHaveLength(1)
    expect((findings[0]?.evidence as { metric: string }).metric).toBe('LCP')
  })

  it('prefers field data and does not also report the lab', async () => {
    const findings = await run(
      psi({ field: field(), lab: { lcpMs: 9000, cls: 0.9, tbtMs: 3000 } }),
    )
    // Real users are fine. A pessimistic simulation must not override them.
    expect(findings).toEqual([])
  })
})

describe('performance.core-web-vitals — lab fallback', () => {
  const lab = (overrides: Partial<NonNullable<PageSpeedSummary['lab']>> = {}) =>
    psi({ lab: { lcpMs: 1500, cls: 0.02, tbtMs: 100, ...overrides } })

  it('stays quiet on a merely mediocre simulated run', async () => {
    // Lab-only reporting starts at "poor", not at "needs improvement": one
    // simulated load on a throttled phone is too weak a signal to charge a
    // site points for being near a threshold.
    expect(await run(lab({ lcpMs: 3000, cls: 0.2, tbtMs: 400 }))).toEqual([])
  })

  it('reports a clearly poor simulated run, one severity step down', async () => {
    const findings = await run(lab({ lcpMs: 6000 }))
    expect(findings).toHaveLength(1)
    // The same LCP from real users would be 'high'.
    expect(findings[0]?.severity).toBe('medium')
  })

  it('leads with the fact that nobody experienced these numbers', async () => {
    for (const finding of await run(lab({ lcpMs: 6000, cls: 0.5, tbtMs: 900 }))) {
      expect(finding.description).toContain('simulated')
      expect(finding.title).toContain('simulated load')
      expect(finding.evidence).toMatchObject({ source: 'Lighthouse lab run' })
    }
  })

  it('uses blocking time as the lab stand-in for INP and says so', async () => {
    const findings = await run(lab({ tbtMs: 900 }))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.description).toContain("lab's stand-in for INP")
  })

  it('never renders a raw millisecond blob at a human', async () => {
    const findings = await run(lab({ lcpMs: 6123.456 }))
    expect(findings[0]?.title).toContain('6.1 s')
    expect(findings[0]?.title).not.toContain('6123.456')
  })
})
