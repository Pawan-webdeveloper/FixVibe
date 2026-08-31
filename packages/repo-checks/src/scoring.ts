/**
 * Repo scoring — findings in, 0–100 per pillar out.
 *
 * The same model as @scanlyfix/checks' computeScores, and it IMPORTS that
 * engine's SEVERITY_PENALTIES rather than redeclaring it: a `high` finding must
 * cost the same whether it lives in a bundle or a commit, and two penalty
 * ladders would let a refactor here drift the meaning of a repo score against
 * the site score that sits beside it on the same dashboard.
 *
 * Coverage, failure, and floor honesty are all inherited from the same rules:
 *   - a pillar with no registered checks reads 100 but is excluded from the
 *     overall aggregate, so a partial registry cannot flatter itself;
 *   - a check that crashed emits no findings, so its pillar scores HIGHER than
 *     the evidence supports, and the pillar comes back in `degraded` for the
 *     diff to refuse to compare — a monitoring product that emails
 *     "improvement" for an outage is the bug this prevents;
 *   - info findings never move a score.
 */

import { SEVERITY_PENALTIES } from '@scanlyfix/checks'
import type { RepoCategory, RepoCheck, RepoCheckError, RepoFinding, RepoScanScores } from './types.ts'
import { REPO_CATEGORY_ORDER } from './types.ts'

const ALL_CATEGORIES = REPO_CATEGORY_ORDER

/**
 * `checks` must be the same list the findings and errors were produced from.
 * An error whose checkId is absent from it cannot be attributed to a pillar and
 * is skipped — see computeScores in @scanlyfix/checks for why guessing here is
 * worse than silence.
 */
export function computeRepoScores(
  findings: readonly RepoFinding[],
  checks: readonly RepoCheck[],
  errors: readonly RepoCheckError[],
): RepoScanScores {
  const scores = {} as Record<RepoCategory, number>
  for (const category of ALL_CATEGORIES) {
    const penalty = findings
      .filter((f) => f.category === category)
      .reduce((sum, f) => sum + SEVERITY_PENALTIES[f.severity], 0)
    scores[category] = Math.max(0, 100 - penalty)
  }

  const categoryOf = new Map(checks.map((check) => [check.id, check.category]))
  const failed = new Set<RepoCategory>()
  for (const error of errors) {
    const category = categoryOf.get(error.checkId)
    if (category) failed.add(category)
  }
  // REPO_CATEGORY_ORDER, so two scans of the same repo produce a byte-identical
  // scores object — which is what makes a stored diff meaningful.
  const degraded = ALL_CATEGORIES.filter((category) => failed.has(category))

  const covered = new Set(checks.map((c) => c.category))
  const coveredScores = ALL_CATEGORIES.filter((c) => covered.has(c)).map((c) => scores[c])
  const overall =
    coveredScores.length === 0
      ? 0 // no checks ran — refuse to fabricate a grade
      : Math.round(coveredScores.reduce((sum, s) => sum + s, 0) / coveredScores.length)

  return { ...scores, overall, degraded }
}
