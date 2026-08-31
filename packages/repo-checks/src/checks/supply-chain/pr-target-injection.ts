/**
 * `pull_request_target` + checkout of the PR head = script injection.
 *
 * `pull_request_target` runs with the repository’s SECRETS and write token, in
 * the base branch's context — so it is the way a fork can be allowed to run a
 * workflow safely. The contract is: never trust the PR's code. The moment a
 * workflow that triggers on `pull_request_target` checks out `github.event.
 * pull_request.head.sha` (or the head ref) and runs it, a fork attacker controls
 * the code that then touches your secrets — that is a documented, repeatedly
 * exploited vulnerability class.
 *
 * This is the one critical supply-chain finding. Evidence includes the exact
 * checkout step so the reviewer can locate it. False positives are bounded:
 * `pull_request_target` without a head checkout is the safe pattern and stays
 * silent.
 */

import type { RepoCheck, RepoFinding, WorkflowFile } from '../../types.ts'
import { parseWorkflow } from '../../util/workflow.ts'

const ID = 'supply-chain.pr-target-injection'

/** Matches a reference to the PR head — the secret-stealing half of the pattern. */
const PR_HEAD = /github\.event\.pull_request\.head\.(sha|ref|repo)/

function offenders(file: WorkflowFile): { job: string; step: string }[] {
  const parsed = parseWorkflow(file)
  if (!parsed) return []
  if (!parsed.on.includes('pull_request_target')) return []
  const hits: { job: string; step: string }[] = []
  for (const job of parsed.jobs) {
    for (const step of job.steps) {
      // `with: ref:` and `with: repository:` are the common checkout knobs.
      // A `run:` step that references the head ref is the same risk.
      const withRef = step.with && (typeof step.with['ref'] === 'string' || typeof step.with['repository'] === 'string')
      const headRefInWith =
        step.with &&
        (PR_HEAD.test(String(step.with['ref'] ?? '')) || PR_HEAD.test(String(step.with['repository'] ?? '')))
      const headRefInRun = step.run ? PR_HEAD.test(step.run) : false
      if (withRef && headRefInWith) {
        hits.push({ job: job.id, step: step.name ?? step.uses ?? step.run ?? 'checkout' })
      } else if (headRefInRun) {
        hits.push({ job: job.id, step: step.name ?? step.run ?? 'run' })
      }
    }
  }
  return hits
}

export const prTargetInjectionCheck: RepoCheck = {
  id: ID,
  category: 'supply-chain',
  title: 'pull_request_target checks out PR head (script injection)',

  run(ctx) {
    const perWorkflow: { workflow: string; steps: { job: string; step: string }[] }[] = []
    for (const file of ctx.api.workflows) {
      const steps = offenders(file)
      if (steps.length > 0) perWorkflow.push({ workflow: file.path, steps })
    }
    if (perWorkflow.length === 0) return []

    return [
      {
        checkId: ID,
        category: 'supply-chain',
        severity: 'critical',
        title: 'Workflow checks out PR head under pull_request_target',
        description:
          'These workflows trigger on `pull_request_target` — which runs with the repository secrets ' +
          'and write token — and then check out the pull request HEAD. A fork attacker controls the ' +
          'code in the head, so they control what runs against your secrets. This is a known, ' +
          'repeatedly-exploited script-injection pattern and the single most dangerous misconfiguration ' +
          'a workflow can carry.',
        evidence: { workflows: perWorkflow },
        remediation:
          'Use `pull_request` (not `pull_request_target`) for any workflow that must run the PR’s own ' +
          'code — it runs without the secrets. If you need `pull_request_target`, never checkout the ' +
          'head ref; operate on the base branch only.',
        fixPrompt:
          'For each offending workflow:\n1. Replace `pull_request_target` with `pull_request` where the ' +
          'workflow needs to run the PR’s code. That trigger carries no secrets, so a fork PR cannot ' +
          'steal them.\n2. If a `pull_request_target` workflow must label or comment on PRs, do it from ' +
          'the base-branch checkout it already has — never `actions/checkout` with `ref: ${{ ' +
          'github.event.pull_request.head.sha }}`.\n3. Re-audit any step that interpolates `${{ ... }}` ' +
          'from the PR body or title into a `run:` block — those are the same injection class.',
      } satisfies RepoFinding,
    ]
  },
}
