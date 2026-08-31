/**
 * Shallow-check behaviour: each governance / ci-cd / supply-chain check fires
 * on the fixture that describes its defect and stays silent on a clean repo.
 *
 * A test here is the contract a check publishes: name the input that triggers
 * it and the severity it emits, so a regression that quiets it or downgrades it
 * is caught at the same commit.
 */

import { describe, expect, it } from 'vitest'
import { runRepoChecks } from '../src/registry.ts'
import { makeRepoContext, protectedBranch } from './helpers.ts'

function findingIds(findings: { checkId: string; severity: string }[]) {
  return new Map(findings.map((f) => [f.checkId, f.severity]))
}

describe('governance checks', () => {
  it('flags a missing .gitignore as high, and a present one that omits .env', async () => {
    const missing = await runRepoChecks(makeRepoContext({ gitignore: null }))
    expect(findingIds(missing.findings).get('governance.gitignore-missing-env')).toBe('high')

    const leaks = await runRepoChecks(
      makeRepoContext({ gitignore: 'node_modules\ndist\n' }),
    )
    expect(findingIds(leaks.findings).get('governance.gitignore-missing-env')).toBe('high')
  })

  it('flags no CODEOWNERS, and sensitive paths uncovered when CODEOWNERS omits them', async () => {
    const none = await runRepoChecks(makeRepoContext({ codeowners: null }))
    expect(findingIds(none.findings).get('governance.no-codeowners')).toBe('medium')
    expect(findingIds(none.findings).has('governance.codeowners-missing-sensitive-paths')).toBe(false)

    // `* @platform` owns everything, so the sensitive paths are covered — the
    // missing-paths check must stay silent. Partial coverage (src/ and docs/
    // owned, .github/ and db/ not) is what triggers it.
    const full = await runRepoChecks(makeRepoContext({ codeowners: '* @platform\n' }))
    expect(findingIds(full.findings).has('governance.codeowners-missing-sensitive-paths')).toBe(false)

    const partialCtx = makeRepoContext({ codeowners: 'src/ @frontend\ndocs/ @docs\n' })
    const partial = await runRepoChecks(partialCtx)
    expect(findingIds(partial.findings).get('governance.codeowners-missing-sensitive-paths')).toBe('medium')
    expect(findingIds(partial.findings).has('governance.no-codeowners')).toBe(false)
  })

  it('flags missing SECURITY.md (low), README (info) and license (low)', async () => {
    const ctx = makeRepoContext({ tree: [], license: null })
    const ids = findingIds((await runRepoChecks(ctx)).findings)
    expect(ids.get('governance.no-security-md')).toBe('low')
    expect(ids.get('governance.no-license')).toBe('low')
    expect(ids.get('governance.no-readme')).toBe('info')
  })
})

describe('ci-cd checks', () => {
  it('flags an unprotected default branch as high', async () => {
    const { findings } = await runRepoChecks(makeRepoContext({ branchProtection: null }))
    const ids = findingIds(findings)
    expect(ids.get('ci-cd.no-branch-protection')).toBe('high')
    // The narrower checks stay silent when there is nothing to read.
    expect(ids.has('ci-cd.no-required-status-checks')).toBe(false)
  })

  it('flags missing required status checks and reviews on a protected branch', async () => {
    const weak = protectedBranch()
    delete (weak as Record<string, unknown>)['required_status_checks']
    delete (weak as Record<string, unknown>)['required_pull_request_reviews']
    const { findings } = await runRepoChecks(makeRepoContext({ branchProtection: weak }))
    const ids = findingIds(findings)
    expect(ids.get('ci-cd.no-required-status-checks')).toBe('high')
    expect(ids.get('ci-cd.no-required-reviews')).toBe('high')
  })

  it('flags force-pushes allowed', async () => {
    const p = protectedBranch()
    ;(p as Record<string, unknown>)['allow_force_pushes'] = { enabled: true }
    const { findings } = await runRepoChecks(makeRepoContext({ branchProtection: p }))
    expect(findingIds(findings).get('ci-cd.force-pushes-allowed')).toBe('high')
  })

  it('flags push protection off', async () => {
    const { findings } = await runRepoChecks(
      makeRepoContext({ securityAndAnalysis: { pushProtection: false } }),
    )
    expect(findingIds(findings).get('ci-cd.no-push-protection')).toBe('medium')
  })

  it('flags mostly-unverified commits', async () => {
    const { findings } = await runRepoChecks(
      makeRepoContext({
        commits: [
          { sha: '1', author: 'a', date: '', message: '', verified: false },
          { sha: '2', author: 'b', date: '', message: '', verified: false },
          { sha: '3', author: 'c', date: '', message: '', verified: true },
        ],
      }),
    )
    expect(findingIds(findings).get('ci-cd.unverified-commits')).toBe('medium')
  })

  it('flags jobs missing timeout-minutes and deploy jobs missing concurrency', async () => {
    const yaml = `name: ci
on: [push]
jobs:
  build:
    steps:
      - run: npm ci
  deploy-prod:
    steps:
      - run: ./deploy.sh
`
    const { findings } = await runRepoChecks(makeRepoContext({ workflows: [{ path: '.github/workflows/ci.yml', name: 'ci', yaml }] }))
    const ids = findingIds(findings)
    expect(ids.get('ci-cd.workflow-missing-timeout')).toBe('medium')
    expect(ids.get('ci-cd.no-concurrency')).toBe('medium')
  })
})

describe('supply-chain checks', () => {
  it('flags third-party actions pinned to a tag (not a SHA)', async () => {
    const yaml = `name: ci
on: [push]
permissions:
  contents: read
jobs:
  build:
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: acme/cool-action@v2
      - uses: ./local-action
`
    const { findings } = await runRepoChecks(makeRepoContext({ workflows: [{ path: '.github/workflows/ci.yml', name: 'ci', yaml }] }))
    expect(findingIds(findings).get('supply-chain.actions-not-pinned-to-sha')).toBe('high')
  })

  it('flags pull_request_target + head checkout as critical', async () => {
    const yaml = `name: label
on: [pull_request_target]
jobs:
  label:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: ./label.sh
`
    const { findings } = await runRepoChecks(makeRepoContext({ workflows: [{ path: '.github/workflows/label.yml', name: 'label', yaml }] }))
    expect(findingIds(findings).get('supply-chain.pr-target-injection')).toBe('critical')
  })

  it('flags permissions: write-all (high) and missing top-level permissions (medium)', async () => {
    const writeAll = `name: a\non: [push]\npermissions: write-all\njobs:\n  a:\n    steps:\n      - run: echo hi\n`
    const { findings } = await runRepoChecks(makeRepoContext({ workflows: [{ path: '.github/workflows/a.yml', name: 'a', yaml: writeAll }] }))
    const ids = findingIds(findings)
    expect(ids.get('supply-chain.permissions-write-all')).toBe('high')
    expect(ids.has('supply-chain.permissions-missing')).toBe(false)

    const none = `name: b\non: [push]\njobs:\n  b:\n    steps:\n      - run: echo hi\n`
    const { findings: noneFindings } = await runRepoChecks(makeRepoContext({ workflows: [{ path: '.github/workflows/b.yml', name: 'b', yaml: none }] }))
    expect(findingIds(noneFindings).get('supply-chain.permissions-missing')).toBe('medium')
  })

  it('flags Dependabot security updates off', async () => {
    const { findings } = await runRepoChecks(
      makeRepoContext({ securityAndAnalysis: { dependabotSecurityUpdates: false } }),
    )
    expect(findingIds(findings).get('supply-chain.dependabot-disabled')).toBe('medium')
  })
})
