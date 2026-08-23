/**
 * @darvin/checks — public surface.
 *
 * Consumers (CLI today; the web app's scan job and the MCP server later) should
 * need exactly three calls: buildContext(url) → runChecks(ctx) → computeScores().
 * Everything else exported here exists for error handling and typed plumbing.
 */

export * from './types.ts'
export { buildContext } from './context/build-context.ts'
export { SsrfError } from './context/ssrf-guard.ts'
export { SafeFetchError } from './context/safe-fetch.ts'
export { allChecks, runChecks, type RunResult } from './registry.ts'
export { computeScores, SEVERITY_PENALTIES } from './scoring.ts'
export { ENGINE_VERSION } from './version.ts'
