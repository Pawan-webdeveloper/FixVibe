/**
 * Workflow hygiene: every job should bound its own runtime and serialise deploys.
 *
 * Two findings, one file. A job without `timeout-minutes` can run for the
 * repository limit (6 hours by default) on a hung step — a runaway that costs
 * Actions minutes and can mask a deadlock behind a green badge. A deploy job
 * without `concurrency:` can run twice on two rapid pushes and ship the older
 * build on top of the newer one, which is how a rollback or a release goes out
 * in the wrong order with no error to see.
 *
 * Both read the parsed workflow, and both stay silent when a file does not
 * parse — a broken YAML is a build error the repo already surfaces, not a
 * finding this engine should also report.
 */

import type { RepoCheck, RepoFinding } from '../../types.ts'
import { parseWorkflow } from '../../util/workflow.ts'

const MISSING_TIMEOUT = 'ci-cd.workflow-missing-timeout'
const NO_CONCURRENCY = 'ci-cd.no-concurrency'

/** A job whose name or id looks like a release/deploy. */
const DEPLOY_RE = /deploy|publish|release|ship|prod/i

export const workflowMissingTimeoutCheck: RepoCheck = {
  id: MISSING_TIMEOUT,
  category: 'ci-cd',
  title: 'Jobs missing timeout-minutes',

  run(ctx) {
    const offenders: { workflow: string; jobs: string[] }[] = []
    for (const file of ctx.api.workflows) {
      const parsed = parseWorkflow(file)
      if (!parsed) continue
      const missing = parsed.jobs.filter((j) => j.timeoutMinutes === undefined).map((j) => j.id)
      if (missing.length > 0) offenders.push({ workflow: file.path, jobs: missing })
    }
    if (offenders.length === 0) return []

    const total = offenders.reduce((n, o) => n + o.jobs.length, 0)
    return [
      {
        checkId: MISSING_TIMEOUT,
        category: 'ci-cd',
        severity: 'medium',
        title: `${total} job${total === 1 ? '' : 's'} missing a timeout`,
        description:
          'These workflow jobs set no `timeout-minutes`, so each can run up to the repository limit ' +
          '(6 hours by default) on a hung step. A deadlock then burns Actions minutes for hours and ' +
          'shows as a green, in-progress job rather than a failure.',
        evidence: { workflows: offenders },
        remediation:
          'Add `timeout-minutes:` to every job. A value in the 10–30 range is reasonable for most ' +
          'work; set it from the build, not after the first hang.',
        fixPrompt:
          offenders
            .map((o) => `${o.workflow}: add \`timeout-minutes: 15\` to job(s) ${o.jobs.join(', ')}`)
            .join('\n') +
          '\n\nSet the value per job based on its real wall-clock, plus headroom. A job that genuinely ' +
          'needs hours is the exception and should be reviewed, not left unbounded.',
      } satisfies RepoFinding,
    ]
  },
}

export const noConcurrencyCheck: RepoCheck = {
  id: NO_CONCURRENCY,
  category: 'ci-cd',
  title: 'Deploy jobs missing concurrency control',

  run(ctx) {
    const offenders: { workflow: string; jobs: string[] }[] = []
    for (const file of ctx.api.workflows) {
      const parsed = parseWorkflow(file)
      if (!parsed) continue
      // A workflow-level concurrency group covers every job in the file.
      if (parsed.concurrency !== undefined) continue
      const deployJobs = parsed.jobs
        .filter((j) => j.concurrency === undefined && (DEPLOY_RE.test(j.id) || (j.name ? DEPLOY_RE.test(j.name) : false)))
        .map((j) => j.id)
      if (deployJobs.length > 0) offenders.push({ workflow: file.path, jobs: deployJobs })
    }
    if (offenders.length === 0) return []

    return [
      {
        checkId: NO_CONCURRENCY,
        category: 'ci-cd',
        severity: 'medium',
        title: 'Deploy jobs have no concurrency control',
        description:
          'These deploy/release jobs set no `concurrency:`, so two runs triggered in quick succession ' +
          'execute in parallel and the older build can land after the newer one — a release shipped in ' +
          'the wrong order, or a rollback overwritten by the deploy it was rolling back.',
        evidence: { workflows: offenders },
        remediation:
          'Add a `concurrency:` group to each deploy job (or the workflow), with `cancel-in-progress` ' +
          'chosen deliberately: true for CI, false for deploys so a half-shipped release is not ' +
          'interrupted by a newer push.',
        fixPrompt:
          offenders
            .map((o) => `${o.workflow}: add to job(s) ${o.jobs.join(', ')}`)
            .join('\n') +
          '\n\nconcurrency:\n  group: ${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: false\n\n' +
          '(Use true for CI jobs that can be cancelled; false for deploys that must finish once started.)',
      } satisfies RepoFinding,
    ]
  },
}
