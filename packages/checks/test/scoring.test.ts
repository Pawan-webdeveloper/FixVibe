/**
 * Scoring contract: predictable deductions, a hard floor at zero, and an
 * overall that only averages pillars we actually have checks for — Phase 0
 * ships security only, and the overall must say so instead of flattering.
 */

import { describe, expect, it } from 'vitest'
import type { Category, Check, Finding, Severity } from '../src/types.ts'
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

describe('computeScores', () => {
  it('gives a clean scan 100 across the board', () => {
    const scores = computeScores([], coverage('security'))
    expect(scores.security).toBe(100)
    expect(scores.overall).toBe(100)
  })

  it('subtracts the documented penalty per severity', () => {
    const scores = computeScores([finding('security', 'high'), finding('security', 'medium')], coverage('security'))
    expect(scores.security).toBe(100 - SEVERITY_PENALTIES.high - SEVERITY_PENALTIES.medium) // 77
    expect(scores.overall).toBe(77)
  })

  it('info findings never move a score', () => {
    const scores = computeScores([finding('security', 'info')], coverage('security'))
    expect(scores.security).toBe(100)
  })

  it('floors a disastrous pillar at 0 instead of going negative', () => {
    const disaster = Array.from({ length: 5 }, () => finding('security', 'critical'))
    expect(computeScores(disaster, coverage('security')).security).toBe(0)
  })

  it('keeps findings in one pillar from bleeding into another', () => {
    const scores = computeScores([finding('security', 'critical')], coverage('security', 'seo'))
    expect(scores.security).toBe(70)
    expect(scores.seo).toBe(100)
  })

  it('averages the overall over covered pillars only', () => {
    // security 70, seo 100, everything else uncovered → overall (70+100)/2 = 85
    const scores = computeScores([finding('security', 'critical')], coverage('security', 'seo'))
    expect(scores.overall).toBe(85)
    // With security-only coverage the same finding makes overall = security.
    expect(computeScores([finding('security', 'critical')], coverage('security')).overall).toBe(70)
  })

  it('refuses to grade when nothing was checked', () => {
    expect(computeScores([], []).overall).toBe(0)
  })
})
