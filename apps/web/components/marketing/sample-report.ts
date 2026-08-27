import type { FindingView } from '@/components/scan/finding-card.tsx'
import type { ScanScores } from '@scanlyfix/checks'

/**
 * A real scan, recorded — not a mockup.
 *
 * Every number and every string below came out of `pnpm scan example.com
 * --json` against the live site. Nothing is invented, because the whole
 * argument this page makes is that the engine reports only what it observed,
 * and a landing page illustrating that claim with fabricated output would be
 * refuting it.
 *
 * example.com rather than a real customer's site: it is IANA's reserved
 * demonstration domain, so publishing its shortcomings costs nobody anything.
 * It also happens to tell the exact story the product is for — an overall 87
 * that looks healthy, sitting on top of a security pillar at 39.
 *
 * Re-record it by re-running the scan when the engine's output changes; the
 * date below is what tells a reader how old this is.
 */

export const SAMPLE = {
  host: 'example.com',
  finalUrl: 'https://example.com/',
  status: 200,
  scannedAt: '2026-08-26',
  durationMs: 919,
  findingCount: 20,
} as const

export const SAMPLE_SCORES: ScanScores = {
  security: 39,
  seo: 85,
  aeo: 100,
  performance: 100,
  accessibility: 97,
  compliance: 100,
  overall: 87,
  degraded: [],
}

/** The three the engine sorted to the top. Worst-first, exactly as it ordered them. */
export const SAMPLE_FINDINGS: readonly FindingView[] = [
  {
    checkId: 'security.headers.csp',
    category: 'security',
    severity: 'high',
    title: 'Missing Content-Security-Policy',
    description:
      'No CSP header or meta tag is set, so any injected script runs with full access to the page — ' +
      'CSP is the main defence-in-depth layer against XSS.',
    remediation:
      "Add a Content-Security-Policy header to every HTML response. Start strict (default-src 'self') " +
      'and loosen only for origins the site really uses.',
  },
  {
    checkId: 'security.tls.https-redirect',
    category: 'security',
    severity: 'high',
    title: 'Site is also reachable over plain HTTP',
    description:
      'http:// serves content (HTTP 200) instead of redirecting. Users and links that start on http ' +
      'never reach the encrypted site, and stay fully interceptable.',
    evidence: { status: 200 },
    remediation: '301-redirect all http:// traffic to https:// and add HSTS once that works.',
  },
  {
    checkId: 'security.headers.hsts',
    category: 'security',
    severity: 'medium',
    title: 'Missing Strict-Transport-Security',
    description:
      'Without HSTS the browser will still try plain HTTP on direct visits and typed URLs, leaving ' +
      'users open to SSL-stripping on hostile networks.',
    remediation:
      'Send Strict-Transport-Security: max-age=31536000; includeSubDomains on all HTTPS responses.',
  },
]

/**
 * The finding the evidence section is built around.
 *
 * Chosen because it is the case a checklist cannot produce: the record exists,
 * the policy is strict, and the defect is a missing tag inside a string only a
 * DNS lookup could have supplied. "Trust me" cannot say this; a quoted record can.
 */
export const SAMPLE_EVIDENCE = {
  claim: 'DMARC record has no rua= reporting address',
  checkId: 'security.email.dmarc',
  severity: 'low',
  observed: {
    name: '_dmarc.example.com',
    record: 'v=DMARC1;p=reject;sp=reject;adkim=s;aspf=s',
  },
  why:
    'The policy is p=reject, so receivers are acting on failures — but with no rua= address the ' +
    'aggregate reports go nowhere. Legitimate mail that starts failing is quarantined with no ' +
    'signal to anyone.',
} as const

/**
 * An excerpt of the aggregate fix prompt for this scan, verbatim.
 *
 * The DNS section is kept because it is the part that shows the prompt is
 * doing something a concatenation of findings cannot: telling an agent which
 * of its instructions are NOT code, so it stops instead of editing a file and
 * reporting success.
 */
export const SAMPLE_FIX_PROMPT = `Fix the issues below on example.com. The stack could not be
identified from the response, so confirm where response headers and page
templates live before editing.

15 issues, grouped by where the change is made. Work through the sections in
order; within a section every change lands in the same place, so make them as
one edit.

## 1. Response headers

Set all of these in wherever response headers are set for this site: the web
server config, the CDN, or the framework's header configuration.

### Missing Content-Security-Policy  [high]
Add a Content-Security-Policy header to all HTML responses in this project.
Configure it in the web server or framework middleware (not a meta tag). Start
from: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self';
frame-ancestors 'self'.

## 2. DNS records — NOT code

These are changed at the DNS provider for the domain. Do NOT edit any file in
the repository for them. If DNS is managed as code here (a zone file, Terraform,
Pulumi, CDK), change it there; otherwise output the exact records to add and stop.

### DMARC record has no rua= reporting address  [low]
The DMARC record at "_dmarc.example.com" is "v=DMARC1;p=reject;sp=reject;
adkim=s;aspf=s" and has no rua= tag, so nobody receives aggregate reports…`
