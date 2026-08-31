/**
 * One prompt that fixes the whole repo.
 *
 * Mirrors @scanlyfix/checks' buildFixPrompt: every finding already carries its
 * own `fixPrompt`, which is enough to fix one thing. This turns a repo report
 * into a single instruction an agent can work through, and the value is in the
 * ORDER a per-finding prompt cannot know:
 *
 *   Secrets are rotated BEFORE any code change, because every later change is
 *   wasted if the key is already in someone's hands. The deep-scan secrets
 *   findings therefore lead, even when a critical code-quality bug sits below
 *   them in the same list.
 *
 *   GitHub settings (branch protection, push protection, Dependabot) are NOT
 *   code — an agent told to "fix no-branch-protection" will otherwise edit a
 *   file, commit it, and report the problem solved. They get their own section
 *   and a forceful "this is a setting, not a file" preamble.
 *
 * Returns an empty string when there is nothing actionable, so callers treat
 * silence as "no prompt" rather than a prompt that says nothing.
 */

import { SEVERITY_ORDER } from '@scanlyfix/checks'
import type { RepoCategory, RepoFinding } from './types.ts'
import { REPO_CATEGORY_ORDER } from './types.ts'

/** Ordered so the urgent surfaces lead. Settings before code, always. */
const SURFACE_ORDER: readonly RepoCategory[] = [
  'secrets',
  'ci-cd',
  'supply-chain',
  'dependencies',
  'code-quality',
  'governance',
]

function heading(category: RepoCategory): { title: string; where: string } {
  switch (category) {
    case 'secrets':
      return {
        title: 'Rotate exposed secrets — do this first',
        where:
          'Every secret below is already published; a code change cannot un-publish it. Rotate each ' +
          'key at its issuer, scrub the leaked value from history, then move the replacement behind a ' +
          'server route or a non-public variable.',
      }
    case 'ci-cd':
      return {
        title: 'Branch protection & workflow hardening (GitHub settings)',
        where:
          'These are repository SETTINGS, not code. Change them in the GitHub UI under Settings → ' +
          'Branches and Settings → Actions. Do NOT edit a file for them; committing a workflow file ' +
          'does not enable branch protection.',
      }
    case 'supply-chain':
      return {
        title: 'Supply chain — third-party code that runs in your name',
        where: 'These are edits to .github/workflows/*.yml (pin SHAs, drop write-all, fix triggers).',
      }
    case 'dependencies':
      return {
        title: 'Dependencies with known vulnerabilities',
        where: 'Update the listed packages to a fixed version and rerun the lockfile update.',
      }
    case 'code-quality':
      return { title: 'Application code', where: 'These are edits to the source files the findings name.' }
    case 'governance':
      return { title: 'Repository files & ownership', where: 'These add or edit files at the repo root.' }
  }
}

const rank = (severity: RepoFinding['severity']) => SEVERITY_ORDER.indexOf(severity)

export interface RepoFixableFinding {
  checkId: string
  severity: RepoFinding['severity']
  title: string
  fixPrompt: string
}

export interface RepoFixPromptContext {
  owner: string
  name: string
  defaultBranch: string
}

export function buildRepoFixPrompt(findings: readonly RepoFixableFinding[], context: RepoFixPromptContext): string {
  const actionable = findings.filter((f) => f.severity !== 'info')
  if (actionable.length === 0) return ''

  const grouped = new Map<RepoCategory, RepoFixableFinding[]>()
  for (const finding of actionable) {
    const surface = surfaceOf(finding.checkId)
    grouped.set(surface, [...(grouped.get(surface) ?? []), finding])
  }

  const lines: string[] = [
    `Fix the issues below in ${context.owner}/${context.name} (default branch: ${context.defaultBranch}).`,
    '',
    `${actionable.length} issues, grouped by where the change is made. Work through the sections in ` +
      'order; the secrets section first, because every later change is wasted if a leaked key is ' +
      'already in someone else\'s hands.',
  ]

  let section = 0
  for (const surface of SURFACE_ORDER) {
    const items = grouped.get(surface)
    if (!items || items.length === 0) continue
    section += 1
    const { title, where } = heading(surface)
    lines.push('', `## ${section}. ${title}`)
    if (where) lines.push('', where)
    lines.push('')
    for (const finding of [...items].sort((a, b) => rank(a.severity) - rank(b.severity))) {
      lines.push(`### ${finding.title}  [${finding.severity}]`)
      lines.push(finding.fixPrompt.trim())
      lines.push('')
    }
  }

  lines.push(
    '---',
    '',
    'When done, re-scan the repo rather than assuming. Several of these are only observable from ' +
      'GitHub (branch protection, push protection) or from a fresh clone (a secret scrubbed from the ' +
      'working tree can still be in history).',
  )

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Map a finding to its surface by checkId prefix. Repo check ids are
 * dot-namespaced with the CATEGORY as the first segment (e.g.
 * `ci-cd.no-branch-protection`, `supply-chain.actions-not-pinned-to-sha`), so
 * the surface is exactly the prefix up to the first dot. Falls back to
 * governance for an unrecognised prefix — the same honest default the site
 * fix-prompt uses for anything it cannot classify.
 */
const SURFACE_BY_PREFIX: ReadonlyArray<{ prefix: string; surface: RepoCategory }> = [
  { prefix: 'secrets.', surface: 'secrets' },
  { prefix: 'supply-chain.', surface: 'supply-chain' },
  { prefix: 'ci-cd.', surface: 'ci-cd' },
  { prefix: 'code-quality.', surface: 'code-quality' },
  { prefix: 'dependencies.', surface: 'dependencies' },
  { prefix: 'governance.', surface: 'governance' },
]

function surfaceOf(checkId: string): RepoCategory {
  return SURFACE_BY_PREFIX.find((entry) => checkId.startsWith(entry.prefix))?.surface ?? 'governance'
}
