/**
 * Content-Security-Policy — the single most effective XSS mitigation, and the
 * header most sites either skip or configure into uselessness. We report:
 *   - no policy at all                       → high
 *   - only Report-Only (nothing enforced)    → medium
 *   - script-src allowing 'unsafe-inline'    → medium (unless nonce/hash/strict-dynamic neutralise it)
 *   - script-src allowing 'unsafe-eval'      → low
 *   - script-src with a bare * wildcard      → medium
 *
 * Multiple policies: a response may carry several CSPs (two headers — which
 * Headers.get() hands us comma-joined — plus <meta> tags). Browsers enforce
 * the INTERSECTION: a script runs only if every policy allows it. So a
 * weakness is only real when EVERY policy that governs scripts has it;
 * flagging one lax policy that a stricter sibling neutralises would be a
 * false positive on a correctly hardened site.
 */

import type { Check, CheckContext, Finding } from '../../types.ts'

const ID = 'security.headers.csp'

/** "default-src 'self'; script-src 'self' cdn.com" → Map { default-src → ['self'], … } */
export function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>()
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    const name = tokens[0]?.toLowerCase()
    // First occurrence wins, per spec — duplicates are ignored by browsers too.
    if (name && !directives.has(name)) directives.set(name, tokens.slice(1))
  }
  return directives
}

/**
 * Split a possibly comma-joined header value into individual policies.
 * Safe because commas cannot appear inside CSP directive values.
 */
function splitPolicies(headerValue: string | null): string[] {
  return headerValue ? headerValue.split(',').map((p) => p.trim()).filter(Boolean) : []
}

/**
 * Every enforced policy on the page, with delivery mechanism preserved —
 * callers care because some directives (frame-ancestors, sandbox) are
 * spec-ignored when delivered via <meta>.
 */
export function getCspPolicies(ctx: CheckContext): { header: string[]; meta: string[] } {
  const header = splitPolicies(ctx.headers.get('content-security-policy'))
  const meta: string[] = []
  ctx.$('meta[http-equiv]').each((_, el) => {
    if ((ctx.$(el).attr('http-equiv') ?? '').trim().toLowerCase() === 'content-security-policy') {
      const content = ctx.$(el).attr('content')?.trim()
      if (content) meta.push(...splitPolicies(content))
    }
  })
  return { header, meta }
}

/** How one policy constrains script execution (script-src, falling back to default-src). */
interface ScriptGovernance {
  /** false when the policy has neither script-src nor default-src — it restricts nothing script-wise. */
  governs: boolean
  sources: string[]
  /** nonce/hash/strict-dynamic present — makes 'unsafe-inline' inert in modern browsers. */
  neutralised: boolean
}

function scriptGovernance(policy: string): ScriptGovernance {
  const directives = parseCsp(policy)
  const list = directives.get('script-src') ?? directives.get('default-src')
  if (!list) return { governs: false, sources: [], neutralised: false }
  const sources = list.map((s) => s.toLowerCase())
  const neutralised = sources.some(
    (s) =>
      s === "'strict-dynamic'" ||
      s.startsWith("'nonce-") ||
      s.startsWith("'sha256-") ||
      s.startsWith("'sha384-") ||
      s.startsWith("'sha512-"),
  )
  return { governs: true, sources, neutralised }
}

export const cspCheck: Check = {
  id: ID,
  category: 'security',
  title: 'Content-Security-Policy',

  run(ctx) {
    const findings: Finding[] = []
    const { header, meta } = getCspPolicies(ctx)
    const policies = [...header, ...meta]
    const reportOnly = ctx.headers.get('content-security-policy-report-only')

    if (policies.length === 0) {
      if (reportOnly) {
        findings.push({
          checkId: ID,
          category: 'security',
          severity: 'medium',
          title: 'CSP is report-only — nothing is enforced',
          description:
            'A Content-Security-Policy-Report-Only header is present, but without an enforcing ' +
            'policy the browser only logs violations; injected scripts still execute.',
          evidence: { reportOnly: truncate(reportOnly) },
          remediation:
            'Promote the policy to an enforcing Content-Security-Policy header once its violation ' +
            'reports are clean.',
          fixPrompt:
            'This site sends Content-Security-Policy-Report-Only but no enforcing Content-Security-Policy ' +
            'header. Find where response headers are configured (web server config or framework middleware) ' +
            'and send the same policy under the header name Content-Security-Policy, keeping the ' +
            'report-only one during rollout.',
        })
      } else {
        findings.push({
          checkId: ID,
          category: 'security',
          severity: 'high',
          title: 'Missing Content-Security-Policy',
          description:
            'No CSP header or meta tag is set, so any injected script runs with full access to the ' +
            'page — CSP is the main defence-in-depth layer against XSS.',
          remediation:
            "Add a Content-Security-Policy header to every HTML response. Start strict (default-src 'self') " +
            'and loosen only for origins the site really uses.',
          fixPrompt:
            'Add a Content-Security-Policy header to all HTML responses in this project. Configure it in ' +
            "the web server or framework middleware (not a meta tag). Start from: default-src 'self'; " +
            "script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'. Then check " +
            'the browser console for violations and add only the specific origins the site loads from.',
        })
      }
      return findings
    }

    const governance = policies.map(scriptGovernance)
    const governing = governance.filter((g) => g.governs)
    /** Evidence string: the script-relevant part of every governing policy. */
    const scriptSrcEvidence = governing.map((g) => g.sources.join(' ')).join('  |  ')

    // A weakness must be (a) explicitly present in at least one policy and
    // (b) permitted by ALL policies — one strict policy vetoes the others' laxity.
    const allowsInline = (g: ScriptGovernance) =>
      !g.governs || (g.sources.includes("'unsafe-inline'") && !g.neutralised)
    if (
      governing.some((g) => g.sources.includes("'unsafe-inline'") && !g.neutralised) &&
      governance.every(allowsInline)
    ) {
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'medium',
        title: "CSP allows 'unsafe-inline' scripts",
        description:
          "The effective script policy permits 'unsafe-inline' with no nonce, hash or 'strict-dynamic', " +
          'which lets injected inline <script> tags run — this cancels most of the XSS protection CSP ' +
          'exists for.',
        evidence: { scriptSrc: scriptSrcEvidence, policies: truncate(policies.join('  |  ')) },
        remediation:
          "Replace 'unsafe-inline' with per-response nonces (script-src 'nonce-…') or move inline " +
          'scripts into files served from your own origin.',
        fixPrompt:
          "This site's Content-Security-Policy allows 'unsafe-inline' in script-src. Refactor inline " +
          '<script> blocks into external files loaded from the site origin, or add a per-request nonce ' +
          "to each inline script and change script-src to use 'nonce-<value>' (plus 'strict-dynamic' " +
          "if scripts load other scripts). Then remove 'unsafe-inline' from the policy.",
      })
    }

    const allowsEval = (g: ScriptGovernance) => !g.governs || g.sources.includes("'unsafe-eval'")
    if (governing.some((g) => g.sources.includes("'unsafe-eval'")) && governance.every(allowsEval)) {
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'low',
        title: "CSP allows 'unsafe-eval'",
        description:
          "The effective script policy permits 'unsafe-eval', allowing eval()/new Function() — a " +
          'common gadget for turning smaller injections into full script execution.',
        evidence: { scriptSrc: scriptSrcEvidence },
        remediation:
          "Remove 'unsafe-eval' and replace eval-dependent code (often old template libraries) with " +
          'eval-free alternatives.',
        fixPrompt:
          "Remove 'unsafe-eval' from this site's Content-Security-Policy script-src. Find code relying " +
          'on eval, new Function, or string-based setTimeout and replace it with direct function calls ' +
          'or precompiled templates, then update the policy.',
      })
    }

    const allowsAll = (g: ScriptGovernance) => !g.governs || g.sources.includes('*')
    if (governing.some((g) => g.sources.includes('*')) && governance.every(allowsAll)) {
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'medium',
        title: 'CSP script-src allows any origin (*)',
        description:
          'A bare * in the effective script-src means scripts may load from anywhere, so the policy ' +
          'places no real restriction on script execution.',
        evidence: { scriptSrc: scriptSrcEvidence },
        remediation: 'List the specific origins the site loads scripts from instead of *.',
        fixPrompt:
          "This site's CSP uses * in script-src (or default-src governing scripts). Inventory the " +
          'script origins actually used (check <script src> tags and the network panel) and replace ' +
          "* with that explicit list plus 'self'.",
      })
    }

    return findings
  },
}

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
