/**
 * Repository files that signal a project is maintained responsibly.
 *
 * Three low/info findings that read the file index (`api.tree`) and the
 * `api.license` field. None is a defect in the way a leaked key is, but each is
 * a gap a security audit or an open-source consumer notices first: a missing
 * SECURITY.md is a missing disclosure path; a missing README is a missing
 * entry point; a missing LICENSE means the code is "all rights reserved" by
 * default, which is rarely what the author intended to communicate.
 *
 * Severities are deliberately low so they inform rather than move the score
 * hard — `info` findings never move it at all (see scoring).
 */

import type { RepoCheck, RepoFinding } from '../../types.ts'

const NO_SECURITY = 'governance.no-security-md'
const NO_README = 'governance.no-readme'
const NO_LICENSE = 'governance.no-license'

/** Case-insensitive filename test against the recursive tree. */
function hasFile(tree: { path: string }[], match: RegExp): boolean {
  return tree.some((e) => match.test(e.path))
}

export const noSecurityMdCheck: RepoCheck = {
  id: NO_SECURITY,
  category: 'governance',
  title: 'No SECURITY.md',

  run(ctx) {
    if (hasFile(ctx.api.tree, /(^|\/)security\.md$/i)) return []
    return [
      {
        checkId: NO_SECURITY,
        category: 'governance',
        severity: 'low',
        title: 'No SECURITY.md',
        description:
          'The repository has no SECURITY.md. A vulnerability reporter who finds this repo has no ' +
          'documented channel to tell the maintainers, so the report goes to a public issue tracker ' +
          'or nowhere — and a Coordinated Disclosure program cannot list it.',
        remediation:
          'Add a SECURITY.md (root or .github/) describing how to report vulnerabilities privately ' +
          'and the expected response time. GitHub surfaces it on the Security tab automatically.',
        fixPrompt:
          'Create SECURITY.md at the repository root:\n\n# Security Policy\n\n## Reporting a Vulnerability\n\n' +
          'Report security issues privately to security@example.com. Do not open a public issue.\n\n' +
          'We acknowledge within 48 hours and aim to ship a fix within 90 days of triage.\n\n' +
          'GitHub will display this on the repository Security tab.',
      } satisfies RepoFinding,
    ]
  },
}

export const noReadmeCheck: RepoCheck = {
  id: NO_README,
  category: 'governance',
  title: 'No README',

  run(ctx) {
    if (hasFile(ctx.api.tree, /^readme(\.md|\.rst|\.txt)$/i)) return []
    return [
      {
        checkId: NO_README,
        category: 'governance',
        severity: 'info',
        title: 'No README',
        description:
          'The repository has no README. GitHub renders the README as the project front page, so its ' +
          'absence is the first thing a visitor — or a dependency auditor — sees.',
        remediation: 'Add a README.md describing what the project is, how to run it, and how to contribute.',
        fixPrompt: 'Add a README.md at the repository root with the project name, a one-line description, ' +
          'a Run section, and a License note. GitHub renders it on the repo home page.',
      } satisfies RepoFinding,
    ]
  },
}

export const noLicenseCheck: RepoCheck = {
  id: NO_LICENSE,
  category: 'governance',
  title: 'No license',

  run(ctx) {
    if (ctx.api.license !== null) return []
    return [
      {
        checkId: NO_LICENSE,
        category: 'governance',
        severity: 'low',
        title: 'No license file',
        description:
          'GitHub reports no license for this repository. Without one, the default is "all rights ' +
          'reserved" — meaning nobody else has the legal right to use, copy, or distribute the code, ' +
          'which is usually not what an open repository intends to communicate.',
        remediation:
          'Add a LICENSE file. For permissive reuse, MIT or Apache-2.0; for copyleft, GPL-3.0. ' +
          'GitHub detects the file and reports the SPDX id automatically.',
        fixPrompt:
          'Add a LICENSE file at the repository root. Choose MIT for simple permissive reuse:\n\n' +
          'MIT License\n\nCopyright (c) [year] [author]\n\n…(full MIT text)…\n\nGitHub will detect it and ' +
          'show the license on the repo page.',
      } satisfies RepoFinding,
    ]
  },
}
