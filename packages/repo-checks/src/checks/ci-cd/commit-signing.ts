/**
 * Commit signature verification.
 *
 * Reads `api.commits` (the recent history) and reports when a majority of
 * recent commits are unverified. A signature does not prove the author is who
 * they claim, but the absence of verified signatures on most commits means the
 * log cannot be relied on to attribute changes — which is exactly what an
 * attacker relies on after pushing a malicious commit under someone else's name.
 *
 * `medium` rather than `high`: signing is a hardening step, and many legitimate
 * histories are unsigned. But a repo that signed everything until last month ' +
 * 'and is now mostly unsigned is a pattern worth surfacing.
 */

import type { RepoCheck, RepoFinding } from '../../types.ts'

const ID = 'ci-cd.unverified-commits'

/** Below this share of verified commits among recent history → report. */
const VERIFIED_THRESHOLD = 0.5

export const unverifiedCommitsCheck: RepoCheck = {
  id: ID,
  category: 'ci-cd',
  title: 'Most recent commits are unsigned',

  run(ctx) {
    const commits = ctx.api.commits
    if (commits.length === 0) return []

    const verified = commits.filter((c) => c.verified).length
    const share = verified / commits.length
    if (share >= VERIFIED_THRESHOLD) return []

    const unverified = commits.length - verified
    return [
      {
        checkId: ID,
        category: 'ci-cd',
        severity: 'medium',
        title: `${unverified} of ${commits.length} recent commits are unverified`,
        description:
          `Only ${Math.round(share * 100)}% of the recent commits on ${ctx.defaultBranch} carry a ` +
          'verified signature. Unverified commits are attributable only by the author name in the log, ' +
          'which is freely forgeable — an attacker who can push can impersonate a maintainer and the ' +
          'history will read as theirs.',
        evidence: { verified, unverified, total: commits.length, shareVerified: share },
        remediation:
          'Require signed commits on the default branch (branch protection → "Require signed commits") ' +
          'and have contributors configure commit signing (GPG or SSH keys).',
        fixPrompt:
          'In the default branch protection rule, enable "Require signed commits". Have each ' +
          'contributor set up commit signing — GitHub supports GPG, SSH, and the X.509 sigstore ' +
          '(keyless) methods — so the protection rule does not block their next push.',
      } satisfies RepoFinding,
    ]
  },
}
