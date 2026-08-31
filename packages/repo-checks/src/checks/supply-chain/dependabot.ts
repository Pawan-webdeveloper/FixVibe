/**
 * Dependabot security updates should be on.
 *
 * A free, zero-config signal: GitHub already knows which of your dependencies
 * have known vulnerabilities, and can open PRs to fix them the day an advisory
 * publishes. A repo that turns this off is choosing to learn about the same ' +
          'vulnerability from a scan like this one instead, later and manually.
 *
 * Pairs with the deep-scan `dependencies.known-vulnerabilities` check, which
 * reads osv-scanner output: that one reports the vulns that are present, this
 * one reports that the mechanism that would have fixed them is switched off.
 */

import type { RepoCheck, RepoFinding } from '../../types.ts'

const ID = 'supply-chain.dependabot-disabled'

export const dependabotDisabledCheck: RepoCheck = {
  id: ID,
  category: 'supply-chain',
  title: 'Dependabot security updates are off',

  run(ctx) {
    if (ctx.api.securityAndAnalysis.dependabotSecurityUpdates) return []
    return [
      {
        checkId: ID,
        category: 'supply-chain',
        severity: 'medium',
        title: 'Dependabot security updates are not enabled',
        description:
          'Dependabot security updates are off. With them on, GitHub opens a PR the day an advisory ' +
          'is published against a dependency you use — turning a future vulnerability into a fix ' +
          'before it is exploited. With them off, the same vulnerability is found later by a scan ' +
          'or, worse, by a report.',
        remediation:
          'Enable Dependabot security updates under Settings → Code security and analysis. It is free ' +
          'and applies to every dependency GitHub can resolve.',
        fixPrompt:
          'In the repository Settings → Code security and analysis, enable Dependabot security ' +
          'updates. Optionally add a `.github/dependabot.yml` to also schedule regular version bumps ' +
          'per ecosystem (npm, pip, etc.), so updates land as reviewable PRs rather than emergencies.',
      } satisfies RepoFinding,
    ]
  },
}
