/**
 * Secret push protection (a repo-level security setting).
 *
 * Distinct from branch protection: this is the `security_and_analysis` flag
 * that makes GitHub refuse a push containing a detected secret in the first
 * place. It is the cheapest defense in the chain — it stops a leak before it
 * is in history, where the secrets checks would otherwise find it after the
 * fact. Off by default on most repos, which is exactly why it is reported.
 */

import type { RepoCheck, RepoFinding } from '../../types.ts'

const ID = 'ci-cd.no-push-protection'

export const noPushProtectionCheck: RepoCheck = {
  id: ID,
  category: 'ci-cd',
  title: 'Secret push protection is off',

  run(ctx) {
    if (ctx.api.securityAndAnalysis.pushProtection) return []
    return [
      {
        checkId: ID,
        category: 'ci-cd',
        severity: 'medium',
        title: 'Secret push protection is not enabled',
        description:
          'Secret scanning push protection is off. With it on, GitHub blocks a push that contains a ' +
          'detected secret BEFORE it reaches the repository — turning a post-leak rotation into a ' +
          'pre-leak refusal. With it off, a committed key lives in history until a later scan or a ' +
          'reporter notices it.',
        remediation:
          'Enable "Push protection" under Settings → Code security and analysis. It is free for public ' +
          'repositories and blocks detected secrets at push time.',
        fixPrompt:
          'In the repository Settings → Code security and analysis, enable:\n- Secret scanning\n' +
          '- Push protection\n\nBoth are zero-cost for public repos and free on private repos on Pro. ' +
          'This stops a secret reaching history rather than finding it after it does.',
      } satisfies RepoFinding,
    ]
  },
}
