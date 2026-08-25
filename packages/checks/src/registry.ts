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

import { SEVERITY_ORDER, type Check, type CheckContext, type CheckError, type Finding } from './types.ts'
import { cspCheck } from './security/headers/csp.ts'
import { hstsCheck } from './security/headers/hsts.ts'
import { permissionsPolicyCheck } from './security/headers/permissions-policy.ts'
import { referrerPolicyCheck } from './security/headers/referrer-policy.ts'
import { xContentTypeOptionsCheck } from './security/headers/x-content-type-options.ts'
import { xFrameOptionsCheck } from './security/headers/x-frame-options.ts'
import { certExpiryCheck } from './security/tls/cert-expiry.ts'
import { httpsRedirectCheck } from './security/tls/https-redirect.ts'
import { tlsProtocolVersionCheck } from './security/tls/protocol-version.ts'
import { formLabelsCheck } from './accessibility/static/form-labels.ts'
import { imgAltCheck } from './accessibility/static/img-alt.ts'
import { linkTextCheck } from './accessibility/static/link-text.ts'
import { cookieBannerCheck } from './compliance/cookie-banner.ts'
import { privacyPolicyLinkCheck } from './compliance/privacy-policy-link.ts'
import { trackersBeforeConsentCheck } from './compliance/trackers-before-consent.ts'
import { cachingHeadersCheck } from './performance/caching-headers.ts'
import { compressionCheck } from './performance/compression.ts'
import { coreWebVitalsCheck } from './performance/psi.ts'
import { imageFormatsCheck } from './performance/image-formats.ts'
import { aiBotsAllowedCheck } from './aeo/ai-bots-allowed.ts'
import { answerStructureCheck } from './aeo/answer-structure.ts'
import { authorDateCheck } from './aeo/author-date.ts'
import { entitySchemaCheck } from './aeo/entity-schema.ts'
import { faqHowToSchemaCheck } from './aeo/faq-howto-schema.ts'
import { llmsTxtCheck } from './aeo/llms-txt.ts'
import { outboundCitationsCheck } from './aeo/outbound-citations.ts'
import { ssrContentCheck } from './aeo/ssr-content.ts'
import { caaCheck } from './domain/caa.ts'
import { domainExpiryCheck } from './domain/expiry.ts'
import { dkimCheck } from './email/dkim.ts'
import { dmarcCheck } from './email/dmarc.ts'
import { spfCheck } from './email/spf.ts'
import { cookieFlagsCheck } from './security/cookies/cookie-flags.ts'
import { corsWildcardCheck } from './security/cors/cors-wildcard.ts'
import { directoryListingCheck } from './security/exposure/directory-listing.ts'
import { sensitivePathsCheck } from './security/exposure/sensitive-paths.ts'
import { sourceMapsCheck } from './security/exposure/source-maps.ts'
import { firebaseRulesCheck } from './security/backend/firebase-rules.ts'
import { supabaseRlsCheck } from './security/backend/supabase-rls.ts'
import { secretsInJsCheck } from './security/secrets/secrets-in-js.ts'
import { sriCheck } from './security/sri.ts'
import { serverHeaderCheck } from './security/info-leak/server-header.ts'
import { xPoweredByCheck } from './security/info-leak/x-powered-by.ts'
import { mixedContentCheck } from './security/mixed-content.ts'
import { securityTxtCheck } from './security/security-txt.ts'
import { brokenLinksCheck } from './seo/broken-links.ts'
import { canonicalCheck } from './seo/canonical.ts'
import { duplicateMetadataCheck } from './seo/duplicate-metadata.ts'
import { faviconCheck } from './seo/favicon.ts'
import { headingOrderCheck } from './seo/heading-order.ts'
import { hreflangCheck } from './seo/hreflang.ts'
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
  dkimCheck,
  // Domain-level: who may issue certificates for this name, and whether the
  // name is still going to be theirs next month.
  caaCheck,
  domainExpiryCheck,
  // Exposure and supply chain. sensitive-paths and source-maps spend probes,
  // so they sit inside the per-scan budget shared with sitemap and security.txt.
  sensitivePathsCheck,
  secretsInJsCheck,
  sourceMapsCheck,
  directoryListingCheck,
  sriCheck,
  // Backend authorization. These two are the only checks in the engine that
  // touch someone else's infrastructure, so they run only when the context
  // grants `activeProbe` — i.e. on a domain the requester has proved they own.
  supabaseRlsCheck,
  firebaseRulesCheck,
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
  faviconCheck,
  headingOrderCheck,
  hreflangCheck,
  // Crawl-powered: silent on a fast scan, because they read evidence only a
  // `deep` scan goes and collects.
  brokenLinksCheck,
  duplicateMetadataCheck,
  // AEO — whether an answer engine can read, resolve and cite this page.
  // ssr-content comes first for a reason: if the text is not in the HTML,
  // nothing else in this pillar can be.
  ssrContentCheck,
  aiBotsAllowedCheck,
  llmsTxtCheck,
  entitySchemaCheck,
  answerStructureCheck,
  faqHowToSchemaCheck,
  authorDateCheck,
  outboundCitationsCheck,
  // Performance — what the response headers and markup can prove without a
  // browser. Field data (PageSpeed) is a later, network-dependent addition.
  compressionCheck,
  cachingHeadersCheck,
  imageFormatsCheck,
  // The only check that reports a measurement rather than an observation, and
  // the only one that needs a third-party API. Silent unless a scan fetched it.
  coreWebVitalsCheck,
  // Accessibility — the static half. Rendered-DOM auditing needs the browser.
  imgAltCheck,
  formLabelsCheck,
  linkTextCheck,
  // Compliance — observable from one uninteracted request.
  trackersBeforeConsentCheck,
  cookieBannerCheck,
  privacyPolicyLinkCheck,
]

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
