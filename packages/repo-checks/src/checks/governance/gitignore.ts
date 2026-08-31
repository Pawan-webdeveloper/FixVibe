/**
 * .gitignore must keep secret-bearing env files out of the tree.
 *
 * The single most common cause of a leaked secret in a repo is a `.env` that
 * was committed before it was gitignored — and the second is a `.gitignore`
 * that never listed it. This check reads the ignore file (or its absence) and
 * reports both: a missing file, and a present file that lets `.env` through.
 *
 * Pairs with `secrets.env-committed` on the deep scan: this one says "the door
 * is open", that one says "something walked through it".
 */

import type { RepoCheck, RepoFinding } from '../../types.ts'

const ID = 'governance.gitignore-missing-env'

/** Matches `.env`, `.env.local`, `.env.production`, etc. as ignore entries. */
const ENV_IGNORE = /^\s*\*?\.env(\.[a-z0-9_-]+)?\s*$/im

export const gitignoreMissingEnvCheck: RepoCheck = {
  id: ID,
  category: 'governance',
  title: '.gitignore does not protect .env files',

  run(ctx) {
    const gitignore = ctx.api.gitignore
    if (gitignore === null) {
      return [
        {
          checkId: ID,
          category: 'governance',
          severity: 'high',
          title: 'No .gitignore file',
          description:
            'The repository has no .gitignore. Without one, every secret-bearing file a developer ' +
            'creates in the working tree is one `git add .` away from being committed and pushed.',
          remediation:
            'Add a .gitignore and include .env, .env.* and any local secret files. Commit it before ' +
            'anything else so the rest of the tree starts from a safe baseline.',
          fixPrompt:
            'Create a .gitignore at the repository root that excludes environment files:\n\n' +
            '# secrets\n.env\n.env.*\n!.env.example\n\n' +
            'Commit it first (`git add .gitignore && git commit`) before staging anything else, so ' +
            'no later `git add .` sweeps a .env into history.',
        } satisfies RepoFinding,
      ]
    }

    if (ENV_IGNORE.test(gitignore)) return []

    return [
      {
        checkId: ID,
        category: 'governance',
        severity: 'high',
        title: '.gitignore does not exclude .env files',
        description:
          'The .gitignore has no entry matching .env or .env.*. A developer who creates .env.local ' +
          'for a secret will commit it with the next `git add .`, and it then lives in history until ' +
          'scrubbed.',
        remediation:
          'Add .env and .env.* to .gitignore, keeping .env.example tracked as the template.',
        fixPrompt:
          'Add these lines to .gitignore, then commit:\n\n.env\n.env.*\n!.env.example\n\n' +
          'If a .env is already tracked, removing it from the index (`git rm --cached .env`) does ' +
          'NOT un-publish what was already pushed — rotate every secret it contained.',
      } satisfies RepoFinding,
    ]
  },
}
