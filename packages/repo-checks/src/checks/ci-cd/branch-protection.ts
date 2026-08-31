/**
 * Branch protection on the default branch.
 *
 * Four findings, one file, because they all read the same `branchProtection`
 * payload and each reports a distinct gap in it. Together they are the
 * difference between a default branch that is protected and one that merely
 * exists: protection can be present and still allow force pushes, still require
 * no reviews, and still gate on no checks. A single "branch not protected"
 * finding would miss every one of those partial configurations, which is where
 * most real repos actually sit.
 *
 * `null` protection is the no-branch-protection finding; the others stay silent
 * then because there is nothing narrower to report.
 */

import type { RepoCheck, RepoFinding } from '../../types.ts'
import { forcePushesAllowed, hasRequiredReviews, hasRequiredStatusChecks, isProtected } from '../../util/protection.ts'

const NO_PROTECTION = 'ci-cd.no-branch-protection'
const NO_STATUS_CHECKS = 'ci-cd.no-required-status-checks'
const NO_REVIEWS = 'ci-cd.no-required-reviews'
const FORCE_PUSHES = 'ci-cd.force-pushes-allowed'

export const noBranchProtectionCheck: RepoCheck = {
  id: NO_PROTECTION,
  category: 'ci-cd',
  title: 'Default branch is not protected',

  run(ctx) {
    if (isProtected(ctx.api.branchProtection)) return []
    return [
      {
        checkId: NO_PROTECTION,
        category: 'ci-cd',
        severity: 'high',
        title: 'Default branch has no protection rule',
        description:
          `The default branch (${ctx.defaultBranch}) has no protection rule. Anyone with push access ` +
          'can force-push to rewrite history, delete the branch, or push commits that bypass every ' +
          'check. Branch protection is the single most effective control against a compromised or ' +
          'mistaken contributor landing code on the protected ref.',
        remediation:
          'Add a branch protection rule for the default branch requiring PRs, disallowing force ' +
          'pushes, and requiring status checks to pass before merge.',
        fixPrompt:
          `In the repository Settings → Branches → Branch protection rules, add a rule for ` +
          `\`${ctx.defaultBranch}\`:\n- Require a pull request before merging (≥1 approval)\n` +
          '- Require status checks to pass (enable the CI workflow(s))\n- Do not allow force pushes\n' +
          '- Do not allow deletions\n\nThis cannot be done from the repository source; it is a ' +
          'GitHub setting. If configuration-as-code is desired, apply it via the Administration ' +
          'API or a Terraform github_branch_protection resource.',
      } satisfies RepoFinding,
    ]
  },
}

export const noRequiredStatusChecksCheck: RepoCheck = {
  id: NO_STATUS_CHECKS,
  category: 'ci-cd',
  title: 'No required status checks',

  run(ctx) {
    if (!isProtected(ctx.api.branchProtection)) return [] // no-branch-protection owns this
    if (hasRequiredStatusChecks(ctx.api.branchProtection)) return []
    return [
      {
        checkId: NO_STATUS_CHECKS,
        category: 'ci-cd',
        severity: 'high',
        title: 'Branch protection requires no status checks',
        description:
          'The default branch is protected but no status checks are required to pass before a merge. ' +
          'A PR can merge while CI is failing, red, or still running — protection that gates on ' +
          'nothing is protection in name only.',
        remediation:
          'Require the repository’s CI workflow(s) as status checks in the branch protection rule, ' +
          'and require branches to be up to date before merging.',
        fixPrompt:
          'Edit the default branch protection rule (Settings → Branches) and under "Require status ' +
          'checks to pass before merging", enable the CI workflow(s). Tick "Require branches to be ' +
          'up to date before merging" so the check runs against the latest code.',
      } satisfies RepoFinding,
    ]
  },
}

export const noRequiredReviewsCheck: RepoCheck = {
  id: NO_REVIEWS,
  category: 'ci-cd',
  title: 'No required code reviews',

  run(ctx) {
    if (!isProtected(ctx.api.branchProtection)) return []
    if (hasRequiredReviews(ctx.api.branchProtection)) return []
    return [
      {
        checkId: NO_REVIEWS,
        category: 'ci-cd',
        severity: 'high',
        title: 'Branch protection requires no reviews',
        description:
          'The default branch is protected but requires no approving reviews. A contributor can ' +
          'open a PR and self-merge it (or merge after 0 approvals), which removes the only human ' +
          'control between a typo and production.',
        remediation:
          'Require at least one approving review before a pull request can merge, and require CODEOWNERS ' +
          'review where ownership is defined.',
        fixPrompt:
          'Edit the default branch protection rule and under "Require a pull request before merging" ' +
          'set "Required number of approvals" to ≥1. Enable "Require review from Code Owners" if ' +
          'a CODEOWNERS file exists, so edits to owned paths route to the owning team.',
      } satisfies RepoFinding,
    ]
  },
}

export const forcePushesAllowedCheck: RepoCheck = {
  id: FORCE_PUSHES,
  category: 'ci-cd',
  title: 'Force pushes allowed on default branch',

  run(ctx) {
    if (!isProtected(ctx.api.branchProtection)) return []
    if (!forcePushesAllowed(ctx.api.branchProtection)) return []
    return [
      {
        checkId: FORCE_PUSHES,
        category: 'ci-cd',
        severity: 'high',
        title: 'Force pushes are allowed on the default branch',
        description:
          'The branch protection rule explicitly allows force pushes. A force push rewrites history ' +
          'and can erase commits, defeat a required-review gate by replaying it, or hide a malicious ' +
          'change behind a rewritten log. There is no legitimate reason to force-push the default ' +
          'branch of a maintained repository.',
        remediation: 'Disable "Allow force pushes" on the default branch protection rule.',
        fixPrompt:
          'Edit the default branch protection rule (Settings → Branches) and turn OFF "Allow force ' +
          'pushes". If a feature branch workflow needs history rewrites, scope the allowance to that ' +
          'branch pattern only — never the default branch.',
      } satisfies RepoFinding,
    ]
  },
}
