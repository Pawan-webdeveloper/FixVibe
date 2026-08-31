/**
 * Repo scoring contract: predictable deductions, a hard floor at zero, an
 * overall that only averages pillars we have checks for, and `degraded` for a
 * pillar whose check crashed. Mirrors the site engine's scoring.test.ts.
 */

import { SEVERITY_PENALTIES } from '@scanlyfix/checks'
import { describe, expect, it } from 'vitest'
import type { RepoCategory, RepoCheck, RepoCheckError, RepoFinding } from '../src/types.ts'
import { computeRepoScores } from '../src/scoring.ts'

const finding = (category: RepoCategory, severity: RepoFinding['severity']): RepoFinding => ({
  checkId: `test.${category}.${severity}`,
  category,
  severity,
  title: 'synthetic',
  description: 'synthetic',
  remediation: 'synthetic',
  fixPrompt: 'synthetic',
})

const coverage = (...categories: RepoCategory[]): RepoCheck[] =>
  categories.map((category) => ({ id: `test.${category}`, category, title: category, run: () => [] }))

const errored = (category: RepoCategory): RepoCheckError => ({
  checkId: `test.${category}`,
  message: 'repo check timed out after 10000ms',
})

describe('computeRepoScores', () => {
  it('gives a clean repo scan 100 across the board', () => {
    const scores = computeRepoScores([], coverage('ci-cd'), [])
    expect(scores['ci-cd']).toBe(100)
    expect(scores.overall).toBe(100)
  })

  it('subtracts the documented penalty per severity', () => {
    const scores = computeRepoScores(
      [finding('ci-cd', 'high'), finding('ci-cd', 'medium')],
      coverage('ci-cd'),
      [],
    )
    expect(scores['ci-cd']).toBe(100 - SEVERITY_PENALTIES.high - SEVERITY_PENALTIES.medium)
    expect(scores.overall).toBe(scores['ci-cd'])
  })

  it('info findings never move a score', () => {
    expect(computeRepoScores([finding('governance', 'info')], coverage('governance'), []).governance).toBe(100)
  })

  it('floors a disastrous pillar at 0', () => {
    const disaster = Array.from({ length: 5 }, () => finding('supply-chain', 'critical'))
    expect(computeRepoScores(disaster, coverage('supply-chain'), [])['supply-chain']).toBe(0)
  })

  it('keeps findings in one pillar from bleeding into another', () => {
    const scores = computeRepoScores([finding('supply-chain', 'critical')], coverage('supply-chain', 'ci-cd'), [])
    expect(scores['supply-chain']).toBe(70)
    expect(scores['ci-cd']).toBe(100)
  })

  it('averages the overall over covered pillars only', () => {
    // supply-chain 70, ci-cd 100 → overall (70+100)/2 = 85
    const scores = computeRepoScores([finding('supply-chain', 'critical')], coverage('supply-chain', 'ci-cd'), [])
    expect(scores.overall).toBe(85)
  })

  it('refuses to grade when nothing was checked', () => {
    expect(computeRepoScores([], [], []).overall).toBe(0)
  })

  it('marks a crashed check\'s pillar degraded instead of quietly improving the score', () => {
    const scores = computeRepoScores([], coverage('ci-cd'), [errored('ci-cd')])
    expect(scores['ci-cd']).toBe(100)
    expect(scores.degraded).toEqual(['ci-cd'])
  })

  it('lists several degraded pillars in stable pillar order, not error order', () => {
    const scores = computeRepoScores(
      [],
      coverage('supply-chain', 'ci-cd'),
      [errored('ci-cd'), errored('supply-chain')],
    )
    expect(scores.degraded).toEqual(['supply-chain', 'ci-cd'])
  })
})
