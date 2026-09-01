/**
 * @scanlyfix/checks — public surface.
 *
 * Consumers (CLI today; the web app's scan job and the MCP server later) should
 * need exactly three calls: buildContext(url) → runChecks(ctx) → computeScores().
 * Everything else exported here exists for error handling and typed plumbing.
 */

export * from './types.ts'
export { buildContext, type BuildContextOptions } from './context/build-context.ts'
export { type PageSpeedOptions } from './context/psi.ts'
export { type ScannerOptions } from './context/rendered.ts'
// The SSRF primitives are exported for apps/scanner, which drives a real
// browser and therefore cannot rely on safeFetch's socket-level `lookup` hook:
// Chromium resolves its own DNS and follows its own redirects, so that service
// has to ask these questions itself.
export {
  assertSafeUrl,
  isPrivateAddress,
  resolvePublicAddresses,
  SsrfError,
  unbracket,
} from './context/ssrf-guard.ts'
export { safeFetch, SafeFetchError, type FetchedPage } from './context/safe-fetch.ts'
// Exported for the monitoring jobs: an uptime probe and a TLS expiry check need
// exactly these two primitives, and running a whole scan for either would be
// wasteful and would claim more than the job actually measured.
export { getTlsInfo } from './context/tls.ts'
/* monitor error — checkSsl and checkDomain were not re-exported from the package index,
 * causing 'has no exported member' errors in monitoring-probe.ts and monitoring route */
export { checkSsl, type SslCheckResult } from './ssl-checker.ts'
export { checkDomain, type DomainCheckResult } from './domain-checker.ts'
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
