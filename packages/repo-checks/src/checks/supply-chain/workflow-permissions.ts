/**
 * Workflow permissions: least privilege, or write-all-by-default.
 *
 * Two checks, one file, because they read the same parsed field and report the
 * same defect at two severities. Split into two checks (rather than one check
 * emitting two findings) so each finding carries its own check's id — the
 * registry and scoring both rely on a finding's checkId matching a registered
 * check's id.
 *
 * `permissions: write-all` hands every token scope to every job, so a step
 * that only needs read can still write. The absence of a top-level
 * `permissions:` is its quieter cousin: GitHub then defaults the `GITHUB_TOKEN`
 * to write on every scope, which is `write-all` in everything but the name.
 */

import type { RepoCheck, RepoFinding, WorkflowFile } from '../../types.ts'
import { parseWorkflow } from '../../util/workflow.ts'

const WRITE_ALL = 'supply-chain.permissions-write-all'
const NO_TOP_LEVEL = 'supply-chain.permissions-missing'

function withWriteAll(file: WorkflowFile): boolean {
  const parsed = parseWorkflow(file)
  return parsed?.permissions === 'write-all'
}

function withoutTopLevel(file: WorkflowFile): boolean {
  const parsed = parseWorkflow(file)
  if (!parsed) return false
  // A workflow with write-all IS missing the least-privilege top-level block,
  // but the write-all check owns that case — report absence only when it is
  // not already reported there, to avoid double-counting the same file.
  return parsed.permissions === undefined
}

export const permissionsWriteAllCheck: RepoCheck = {
  id: WRITE_ALL,
  category: 'supply-chain',
  title: 'Workflow uses permissions: write-all',

  run(ctx) {
    const files = ctx.api.workflows.filter(withWriteAll).map((f) => f.path)
    if (files.length === 0) return []
    return [
      {
        checkId: WRITE_ALL,
        category: 'supply-chain',
        severity: 'high',
        title: 'Workflow uses permissions: write-all',
        description:
          'These workflows declare `permissions: write-all`, granting every token scope to every job. ' +
          'A step that only needs read access can then write, and a compromised or buggy action writes ' +
          'for it — the principle of least privilege exists precisely to bound that blast radius.',
        evidence: { workflows: files },
        remediation:
          'Replace `write-all` with an explicit list of only the scopes each workflow needs, ideally ' +
          'read-only (`contents: read`) with a per-job elevation only where a write is required.',
        fixPrompt:
          'Replace at the top of each listed workflow:\n\npermissions:\n  contents: read\n  pull-requests: read\n\n' +
          'Add a job-level `permissions:` with the specific write scope only where a job proves it needs ' +
          'one (e.g. a release job: `contents: write`). Never `write-all`.',
      } satisfies RepoFinding,
    ]
  },
}

export const permissionsMissingCheck: RepoCheck = {
  id: NO_TOP_LEVEL,
  category: 'supply-chain',
  title: 'Workflow declares no top-level permissions',

  run(ctx) {
    const files = ctx.api.workflows.filter(withoutTopLevel).map((f) => f.path)
    if (files.length === 0) return []
    return [
      {
        checkId: NO_TOP_LEVEL,
        category: 'supply-chain',
        severity: 'medium',
        title: 'Workflow declares no top-level permissions',
        description:
          'These workflows set no top-level `permissions:`. GitHub then defaults the `GITHUB_TOKEN` to ' +
          'write on every scope — which is `write-all` in everything but the name. A workflow that ' +
          'reads a package can still push to the repo, and a leaked token does the same.',
        evidence: { workflows: files },
        remediation:
          'Add a top-level `permissions:` block with the read scopes the workflow needs. The default ' +
          'should be read-only; elevate per job only where a write is required.',
        fixPrompt:
          'Add at the top of each listed workflow, under `on:` and before `jobs:`:\n\npermissions:\n  ' +
          'contents: read\n  pull-requests: read\n\nThen elevate per job only where a write is proven ' +
          'necessary.',
      } satisfies RepoFinding,
    ]
  },
}
