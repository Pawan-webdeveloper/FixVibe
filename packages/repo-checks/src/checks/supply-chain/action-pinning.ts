/**
 * Third-party GitHub Actions must be pinned to a commit SHA.
 *
 * A `uses: owner/action@v3` is a mutable reference: the tag `v3` can be moved
 * (or force-pushed) by the action's owner at any time, including after your
 * workflow was written. The next run fetches whatever `v3` points at that day,
 * which is a supply-chain takeover vector — pin the tag to the SHA it pointed
 * at when you reviewed it.
 *
 * One finding per workflow listing every offending action, deduplicated by
 * `uses` string. Local (`./`) and first-party (`actions/`, `github/`) actions
 * are deliberately not reported: a local action is your own code, and the
 * first-party set is maintained by GitHub. The signal would be noise against
 * the third-party actions that are the real risk.
 *
 * This collapses the plan's `actions-pinned-to-tag` + `unpinned-third-party-
 * action` into one check on purpose: both describe the same defect (a
 * third-party action not pinned to a SHA) and reporting it twice would violate
 * the engine's "report it once" rule.
 */

import type { RepoCheck, RepoFinding } from '../../types.ts'
import { isCommitSha, isFirstPartyAction, isLocalAction, parseWorkflow } from '../../util/workflow.ts'

const ID = 'supply-chain.actions-not-pinned-to-sha'

export const actionsNotPinnedToShaCheck: RepoCheck = {
  id: ID,
  category: 'supply-chain',
  title: 'Third-party actions not pinned to a commit SHA',

  run(ctx) {
    const perWorkflow: { workflow: string; actions: string[] }[] = []
    for (const file of ctx.api.workflows) {
      const parsed = parseWorkflow(file)
      if (!parsed) continue
      const seen = new Set<string>()
      for (const job of parsed.jobs) {
        for (const step of job.steps) {
          if (!step.uses) continue
          if (isLocalAction(step.uses) || isFirstPartyAction(step.uses)) continue
          const at = step.uses.lastIndexOf('@')
          if (at === -1) continue
          const ref = step.uses.slice(at + 1)
          if (isCommitSha(ref)) continue
          if (!seen.has(step.uses)) seen.add(step.uses)
        }
      }
      if (seen.size > 0) perWorkflow.push({ workflow: file.path, actions: [...seen] })
    }
    if (perWorkflow.length === 0) return []

    const total = perWorkflow.reduce((n, w) => n + w.actions.length, 0)
    return [
      {
        checkId: ID,
        category: 'supply-chain',
        severity: 'high',
        title: `${total} third-party action${total === 1 ? '' : 's'} not pinned to a SHA`,
        description:
          'These actions are referenced by a tag or branch (`@v3`, `@main`) rather than a commit SHA. ' +
          'A tag is mutable: the action owner can move it to point at different code tomorrow, and ' +
          'the next workflow run will execute that code without any review on your side. Pin to the ' +
          'exact commit you audited.',
        evidence: { workflows: perWorkflow },
        remediation:
          'For each action, resolve its current `@tag` to the commit SHA it points at, then replace ' +
          'the tag with that SHA. Add a comment naming the version for readability.',
        fixPrompt:
          perWorkflow
            .flatMap((w) =>
              w.actions.map((a) => `${w.workflow}: replace \`${a}\` with \`${a.split('@')[0]}@<commit-sha>\``),
            )
            .join('\n') +
          '\n\nResolve each tag: `gh api repos/<owner>/<action>/git/refs/tags/<tag> --jq .object.sha` ' +
          'gives the SHA (for annotated tags, follow the tag object to the commit). Add a trailing ' +
          '# comment with the tag name so the version is still legible.',
      } satisfies RepoFinding,
    ]
  },
}
