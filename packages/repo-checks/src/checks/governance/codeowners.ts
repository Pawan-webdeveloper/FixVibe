/**
 * CODEOWNERS — who must review changes to which paths.
 *
 * Two findings, one file. A repo with no CODEOWNERS at all has no enforced
 * review ownership, so anything can land with nobody accountable. A repo whose
 * CODEOWNERS exists but leaves the sensitive paths unowned is worse in a way:
 * it gives the appearance of a gate that is in fact open exactly where it
 * matters — `.github/` (who can change the CI), the infra/config, the
 * migration directory, the secrets manifests.
 */

import type { RepoCheck, RepoFinding } from '../../types.ts'

const NO_CODEOWNERS = 'governance.no-codeowners'
const MISSING_PATHS = 'governance.codeowners-missing-sensitive-paths'

/**
 * Path prefixes that change who can deploy, who can change CI, or who can move
 * the schema. Each is the kind of change a lone contributor should not land
 * unreviewed, and CODEOWNERS is the mechanism that prevents that.
 */
const SENSITIVE_PATHS = ['.github/', 'infra/', 'infrastructure/', 'terraform/', 'pulumi/', 'db/', 'migrations/', 'k8s/']

/** Extract the glob/owner tokens from a non-empty, non-comment CODEOWNERS line. */
function ownedPaths(codeowners: string): string[] {
  const paths: string[] = []
  for (const line of codeowners.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    // The first whitespace-delimited token is the path; the rest are owners.
    const path = trimmed.split(/\s+/)[0]!
    paths.push(path)
  }
  return paths
}

function coversSensitive(owned: string[], sensitive: string): boolean {
  // A CODEOWNERS entry like "infra/" or "/.github/" or ".github/**" covers the
  // sensitive prefix. Exact-prefix match is enough; globs over the same prefix
  // also start with it.
  return owned.some((p) => p.replace(/^\/+/, '').startsWith(sensitive) || sensitive.startsWith(p.replace(/^\/+/, '').replace(/\*+$/, '')))
}

export const noCodeownersCheck: RepoCheck = {
  id: NO_CODEOWNERS,
  category: 'governance',
  title: 'No CODEOWNERS file',

  run(ctx) {
    if (ctx.api.codeowners !== null) return []
    return [
      {
        checkId: NO_CODEOWNERS,
        category: 'governance',
        severity: 'medium',
        title: 'No CODEOWNERS file',
        description:
          'The repository has no .github/CODEOWNERS. Branch protection can require approvals, but ' +
          'without CODEOWNERS those approvals are not routed to the people who own the code being ' +
          'changed — a deploy config edit can be approved by a reviewer who has never touched infra.',
        remediation:
          'Add .github/CODEOWNERS mapping the sensitive paths and major directories to their owning ' +
          'team(s), then require CODEOWNERS review in the default branch protection rule.',
        fixPrompt:
          'Create .github/CODEOWNERS with entries for the paths that matter, e.g.:\n\n' +
          '.github/                 @platform\ninfra/                   @platform\ndb/migrations/           @data\n' +
          '\nThen, in the branch protection rule for the default branch, enable "Require review from ' +
          'Code Owners" so an edit to one of these paths cannot merge without that team.',
      } satisfies RepoFinding,
    ]
  },
}

export const codeownersMissingSensitivePathsCheck: RepoCheck = {
  id: MISSING_PATHS,
  category: 'governance',
  title: 'CODEOWNERS does not cover sensitive paths',

  run(ctx) {
    const codeowners = ctx.api.codeowners
    if (codeowners === null) return [] // the no-codeowners check owns this case

    const owned = ownedPaths(codeowners)
    const uncovered = SENSITIVE_PATHS.filter((s) => !coversSensitive(owned, s))
    if (uncovered.length === 0) return []

    return [
      {
        checkId: MISSING_PATHS,
        category: 'governance',
        severity: 'medium',
        title: 'CODEOWNERS leaves sensitive paths unowned',
        description:
          `CODEOWNERS exists but no entry covers: ${uncovered.join(', ')}. A pull request that edits ` +
          'one of these paths can be approved by a reviewer who does not own it, which is exactly the ' +
          'kind of change CODEOWNERS exists to gate.',
        evidence: { uncoveredPaths: uncovered, ownedPaths: owned },
        remediation:
          'Add CODEOWNERS entries for the listed paths so reviews route to the team that owns them.',
        fixPrompt:
          `Add lines to .github/CODEOWNERS for the uncovered paths, mapping each to its owning team:\n\n` +
          uncovered.map((p) => `${p}  @your-platform-team`).join('\n') +
          '\n\nUse a trailing slash to own the directory recursively, or a glob to own by pattern.',
      } satisfies RepoFinding,
    ]
  },
}
