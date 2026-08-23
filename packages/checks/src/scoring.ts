/**
 * Scoring — findings in, 0–100 per pillar out.
 *
 * Model: every pillar starts at a perfect 100 and each finding subtracts a
 * fixed penalty by severity. Simple on purpose: users must be able to predict
 * "fix the high → score goes up 15", and two scans must be comparable diffs.
 *
 * Coverage honesty: a pillar with no registered checks still *reads* 100
 * ("no known issues") but is EXCLUDED from the overall aggregate — otherwise a
 * registry that only ships security and SEO checks would report a flattering
 * overall inflated by four untested pillars.
 *
 * Failure honesty: a check that crashed or timed out emits no findings, so it
 * subtracts no penalty, so its pillar scores HIGHER than the evidence supports.
 * Left alone that is the worst kind of bug — a network hiccup during a re-scan
 * reads as "your site improved", and a monitoring product built on it emails
 * congratulations for an outage. `errors` is therefore a required argument, not
 * an optional one: the compiler makes every caller decide, and the pillars it
 * touches come back in `degraded` for the UI and the diff to respect.
 *
 * What this deliberately does NOT do: guess a penalty for the check that died,
 * or drop the pillar to zero. Both invent a measurement. Reporting the number
 * that was actually observed and flagging it as partial is the only honest
 * option available.
 */

import type { Category, Check, CheckError, Finding, ScanScores, Severity } from './types.ts'

export const SEVERITY_PENALTIES: Record<Severity, number> = {
  critical: 30,
  high: 15,
  medium: 8,
  low: 3,
  info: 0, // informational rows inform; they never move a score
}

const ALL_CATEGORIES: readonly Category[] = ['security', 'seo', 'aeo', 'performance', 'accessibility', 'compliance']

/**
 * `checks` must be the same list the findings and errors were produced from.
 * An error whose checkId is absent from it cannot be attributed to a pillar and
 * is skipped — the alternatives are understating (mark nothing) or overstating
 * (mark everything), and a caller passing mismatched lists has a bug that a
 * silently wrong score would only hide.
 */
export function computeScores(
  findings: readonly Finding[],
  checks: readonly Check[],
  errors: readonly CheckError[],
): ScanScores {
  const scores = {} as Record<Category, number>
  for (const category of ALL_CATEGORIES) {
    const penalty = findings
      .filter((f) => f.category === category)
      .reduce((sum, f) => sum + SEVERITY_PENALTIES[f.severity], 0)
    scores[category] = Math.max(0, 100 - penalty)
  }

  const categoryOf = new Map(checks.map((check) => [check.id, check.category]))
  const failed = new Set<Category>()
  for (const error of errors) {
    const category = categoryOf.get(error.checkId)
    if (category) failed.add(category)
  }
  // Emitted in ALL_CATEGORIES order so two scans of the same site produce a
  // byte-identical scores object, which is what makes a stored diff meaningful.
  const degraded = ALL_CATEGORIES.filter((category) => failed.has(category))

  const covered = new Set(checks.map((c) => c.category))
  const coveredScores = ALL_CATEGORIES.filter((c) => covered.has(c)).map((c) => scores[c])
  const overall =
    coveredScores.length === 0
      ? 0 // no checks ran — refuse to fabricate a grade
      : Math.round(coveredScores.reduce((sum, s) => sum + s, 0) / coveredScores.length)

  return { ...scores, overall, degraded }
}
