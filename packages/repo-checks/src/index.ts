/**
 * @scanlyfix/repo-checks — public surface.
 *
 * The direct parallel of @scanlyfix/checks. Consumers (the github-scanner
 * worker today; the web app's repo-scan job later) need exactly three calls:
 * a context is built by the worker → runRepoChecks(ctx) → computeRepoScores().
 * Everything else exported here exists for error handling and typed plumbing.
 *
 * Severity is re-exported from @scanlyfix/checks so the two engines can never
 * drift on it; RepoCategory is this package's own union.
 */

export * from './types.ts'
export { allRepoChecks, runRepoChecks, type RepoRunResult } from './registry.ts'
export { computeRepoScores } from './scoring.ts'
export { REPO_ENGINE_VERSION } from './version.ts'
export {
  buildRepoFixPrompt,
  type RepoFixableFinding,
  type RepoFixPromptContext,
} from './fix-prompt.ts'
