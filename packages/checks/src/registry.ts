/**
 * Check registry + runner.
 *
 * `allChecks` is the single source of truth for what a scan runs — the CLI,
 * the web app's Inngest job and scoring coverage all derive from this list.
 * Adding a check = one import + one array entry; nothing else in the engine
 * changes.
 *
 * Runner rules:
 *   - Checks run concurrently: they are CPU-trivial and at most one probe deep,
 *     so wall-clock time stays that of the slowest probe, not the sum.
 *   - A check that throws or hangs must never kill the scan. Failures are
 *     collected as CheckError, reported alongside findings, and the rest of
 *     the report stays valid.
 *   - Output order is deterministic (severity, then id) so diffs between two
 *     scans of the same site are meaningful.
 */

import { SEVERITY_ORDER, type Check, type CheckContext, type Finding } from './types.ts'
import { cspCheck } from './security/headers/csp.ts'
import { hstsCheck } from './security/headers/hsts.ts'
import { permissionsPolicyCheck } from './security/headers/permissions-policy.ts'
import { referrerPolicyCheck } from './security/headers/referrer-policy.ts'
import { xContentTypeOptionsCheck } from './security/headers/x-content-type-options.ts'
import { xFrameOptionsCheck } from './security/headers/x-frame-options.ts'
import { certExpiryCheck } from './security/tls/cert-expiry.ts'
import { httpsRedirectCheck } from './security/tls/https-redirect.ts'
import { tlsProtocolVersionCheck } from './security/tls/protocol-version.ts'
import { dmarcCheck } from './email/dmarc.ts'
import { spfCheck } from './email/spf.ts'
import { cookieFlagsCheck } from './security/cookies/cookie-flags.ts'
import { corsWildcardCheck } from './security/cors/cors-wildcard.ts'
import { serverHeaderCheck } from './security/info-leak/server-header.ts'
import { xPoweredByCheck } from './security/info-leak/x-powered-by.ts'
import { mixedContentCheck } from './security/mixed-content.ts'
import { securityTxtCheck } from './security/security-txt.ts'
import { canonicalCheck } from './seo/canonical.ts'
import { h1Check } from './seo/h1.ts'
import { langCheck } from './seo/lang.ts'
import { metaDescriptionCheck } from './seo/meta-description.ts'
import { openGraphCheck } from './seo/open-graph.ts'
import { robotsMetaCheck } from './seo/robots-meta.ts'
import { robotsTxtCheck } from './seo/robots-txt.ts'
import { sitemapCheck } from './seo/sitemap.ts'
import { structuredDataCheck } from './seo/structured-data.ts'
import { titleCheck } from './seo/title.ts'
import { twitterCardCheck } from './seo/twitter-card.ts'
import { viewportCheck } from './seo/viewport.ts'

export const allChecks: readonly Check[] = [
  cspCheck,
  hstsCheck,
  xFrameOptionsCheck,
  xContentTypeOptionsCheck,
  referrerPolicyCheck,
  permissionsPolicyCheck,
  certExpiryCheck,
  tlsProtocolVersionCheck,
  httpsRedirectCheck,
  cookieFlagsCheck,
  corsWildcardCheck,
  mixedContentCheck,
  serverHeaderCheck,
  xPoweredByCheck,
  securityTxtCheck,
  spfCheck,
  dmarcCheck,
  // SEO — order here is cosmetic: checks run concurrently and findings are
  // sorted by severity before anyone sees them.
  robotsMetaCheck,
  robotsTxtCheck,
  sitemapCheck,
  titleCheck,
  metaDescriptionCheck,
  h1Check,
  viewportCheck,
  canonicalCheck,
  langCheck,
  openGraphCheck,
  twitterCardCheck,
  structuredDataCheck,
]

/** A check that crashed or timed out — a bug in US (or a hostile page), not a site finding. */
export interface CheckError {
  checkId: string
  message: string
}

export interface RunResult {
  findings: Finding[]
  errors: CheckError[]
}

/** Generous: a check performs at most one probe (~5s cap) plus trivial CPU work. */
const CHECK_TIMEOUT_MS = 10_000

export async function runChecks(ctx: CheckContext, checks: readonly Check[] = allChecks): Promise<RunResult> {
  const results = await Promise.all(
    checks.map(async (check): Promise<Finding[] | CheckError> => {
      try {
        return await withTimeout(Promise.resolve(check.run(ctx)), check.id)
      } catch (error) {
        return { checkId: check.id, message: error instanceof Error ? error.message : String(error) }
      }
    }),
  )

  const findings: Finding[] = []
  const errors: CheckError[] = []
  for (const result of results) {
    if (Array.isArray(result)) findings.push(...result)
    else errors.push(result)
  }

  const rank = (f: Finding) => SEVERITY_ORDER.indexOf(f.severity)
  findings.sort((a, b) => rank(a) - rank(b) || a.checkId.localeCompare(b.checkId))

  return { findings, errors }
}

async function withTimeout(work: Promise<Finding[]>, checkId: string): Promise<Finding[]> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`check timed out after ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS)
    timer.unref() // never keep the process alive just to fail a check
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}
