/**
 * Scoring — findings in, 0–100 per pillar out.
 *
 * Model: every pillar starts at a perfect 100 and each finding subtracts a
 * fixed penalty by severity. Simple on purpose: users must be able to predict
 * "fix the high → score goes up 15", and two scans must be comparable diffs.
 *
 * Coverage honesty: a pillar with no registered checks still *reads* 100
 * ("no known issues") but is EXCLUDED from the overall aggregate — otherwise
 * Phase 0, which only ships security checks, would report a flattering
 * overall inflated by five untested pillars.
 */

import type { Category, Check, Finding, ScanScores, Severity } from './types.ts'

export const SEVERITY_PENALTIES: Record<Severity, number> = {
  critical: 30,
  high: 15,
  medium: 8,
  low: 3,
  info: 0, // informational rows inform; they never move a score
}

const ALL_CATEGORIES: readonly Category[] = ['security', 'seo', 'aeo', 'performance', 'accessibility', 'compliance']

export function computeScores(findings: readonly Finding[], checks: readonly Check[]): ScanScores {
  const scores = {} as Record<Category, number>
  for (const category of ALL_CATEGORIES) {
    const penalty = findings
      .filter((f) => f.category === category)
      .reduce((sum, f) => sum + SEVERITY_PENALTIES[f.severity], 0)
    scores[category] = Math.max(0, 100 - penalty)
  }

  const covered = new Set(checks.map((c) => c.category))
  const coveredScores = ALL_CATEGORIES.filter((c) => covered.has(c)).map((c) => scores[c])
  const overall =
    coveredScores.length === 0
      ? 0 // no checks ran — refuse to fabricate a grade
      : Math.round(coveredScores.reduce((sum, s) => sum + s, 0) / coveredScores.length)

  return { ...scores, overall }
}
