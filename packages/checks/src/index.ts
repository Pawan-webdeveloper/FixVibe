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
export { safeFetch, SafeFetchError, type FetchedPage } from './context/safe-fetch.ts'
// Exported for the monitoring jobs: an uptime probe and a TLS expiry check need
// exactly these two primitives, and running a whole scan for either would be
// wasteful and would claim more than the job actually measured.
export { getTlsInfo } from './context/tls.ts'
export { allChecks, runChecks, type RunResult } from './registry.ts'
export { computeScores, SEVERITY_PENALTIES } from './scoring.ts'
export { ENGINE_VERSION } from './version.ts'
export {
  buildFixPrompt,
  detectStack,
  type FixableFinding,
  type FixPromptContext,
  type StackHint,
} from './fix-prompt.ts'
