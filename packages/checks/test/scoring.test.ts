/**
 * Scoring contract: predictable deductions, a hard floor at zero, and an
 * overall that only averages pillars we actually have checks for — Phase 0
 * ships security only, and the overall must say so instead of flattering.
 */

import { describe, expect, it } from 'vitest'
import type { Category, Check, CheckError, Finding, Severity } from '../src/types.ts'
import { computeScores, SEVERITY_PENALTIES } from '../src/scoring.ts'

const finding = (category: Category, severity: Severity): Finding => ({
  checkId: `test.${category}.${severity}`,
  category,
  severity,
  title: 'synthetic',
  description: 'synthetic',
  remediation: 'synthetic',
  fixPrompt: 'synthetic',
})

const coverage = (...categories: Category[]): Check[] =>
  categories.map((category) => ({ id: `test.${category}`, category, title: category, run: () => [] }))

const errored = (category: Category): CheckError => ({
  checkId: `test.${category}`,
  message: 'check timed out after 10000ms',
})

describe('computeScores', () => {
  it('gives a clean scan 100 across the board', () => {
    const scores = computeScores([], coverage('security'), [])
    expect(scores.security).toBe(100)
    expect(scores.overall).toBe(100)
  })

  it('subtracts the documented penalty per severity', () => {
    const scores = computeScores([finding('security', 'high'), finding('security', 'medium')], coverage('security'), [])
    expect(scores.security).toBe(100 - SEVERITY_PENALTIES.high - SEVERITY_PENALTIES.medium) // 77
    expect(scores.overall).toBe(77)
  })

  it('info findings never move a score', () => {
    const scores = computeScores([finding('security', 'info')], coverage('security'), [])
    expect(scores.security).toBe(100)
  })

  it('floors a disastrous pillar at 0 instead of going negative', () => {
    const disaster = Array.from({ length: 5 }, () => finding('security', 'critical'))
    expect(computeScores(disaster, coverage('security'), []).security).toBe(0)
  })

  it('keeps findings in one pillar from bleeding into another', () => {
    const scores = computeScores([finding('security', 'critical')], coverage('security', 'seo'), [])
    expect(scores.security).toBe(70)
    expect(scores.seo).toBe(100)
  })

  it('averages the overall over covered pillars only', () => {
    // security 70, seo 100, everything else uncovered → overall (70+100)/2 = 85
    const scores = computeScores([finding('security', 'critical')], coverage('security', 'seo'), [])
    expect(scores.overall).toBe(85)
    // With security-only coverage the same finding makes overall = security.
    expect(computeScores([finding('security', 'critical')], coverage('security'), []).overall).toBe(70)
  })

  it('refuses to grade when nothing was checked', () => {
    expect(computeScores([], [], []).overall).toBe(0)
  })

  it('reports no degraded pillars on a clean run', () => {
    expect(computeScores([], coverage('security'), []).degraded).toEqual([])
  })

  describe('a check that failed to complete', () => {
    it('marks its pillar degraded instead of quietly improving the score', () => {
      // The bug this exists to prevent: a check that timed out emits no
      // findings, so it deducts nothing, so the pillar reads better than the
      // evidence supports — and on a re-scan that looks like an improvement.
      const scores = computeScores([], coverage('security'), [errored('security')])
      expect(scores.security).toBe(100)
      expect(scores.degraded).toEqual(['security'])
    })

    it('does not invent a penalty for the measurement it never took', () => {
      // Guessing in either direction fabricates data. The number stays the one
      // that was actually observed; `degraded` is how the caller learns it is partial.
      const withError = computeScores([finding('security', 'high')], coverage('security'), [errored('security')])
      const without = computeScores([finding('security', 'high')], coverage('security'), [])
      expect(withError.security).toBe(without.security)
      expect(withError.overall).toBe(without.overall)
    })

    it('degrades only the pillar the failed check belonged to', () => {
      const scores = computeScores([], coverage('security', 'seo'), [errored('seo')])
      expect(scores.degraded).toEqual(['seo'])
    })

    it('lists several degraded pillars in a stable order', () => {
      // Byte-identical output for identical input is what makes a stored diff
      // meaningful, so the order follows the pillar list, not the error list.
      const scores = computeScores([], coverage('security', 'seo'), [errored('seo'), errored('security')])
      expect(scores.degraded).toEqual(['security', 'seo'])
    })

    it('deduplicates when two checks in one pillar fail', () => {
      const errors: CheckError[] = [
        { checkId: 'test.security', message: 'boom' },
        { checkId: 'test.security', message: 'boom again' },
      ]
      expect(computeScores([], coverage('security'), errors).degraded).toEqual(['security'])
    })

    it('skips an error it cannot attribute to any registered check', () => {
      // Mismatched lists are a caller bug. Marking nothing understates and
      // marking everything overstates; neither is worth guessing at here.
      const orphan: CheckError[] = [{ checkId: 'test.not-in-this-run', message: 'boom' }]
      expect(computeScores([], coverage('security'), orphan).degraded).toEqual([])
    })
  })
})
