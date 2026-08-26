/**
 * Credential shapes worth reporting, and the redaction that keeps finding one
 * from becoming a second leak.
 *
 * Only high-confidence, issuer-defined prefixes. There is deliberately no
 * entropy heuristic: "this string looks random" flags minified identifiers,
 * content hashes and build ids on essentially every bundle on the internet, and
 * a security scanner that cries wolf about a webpack chunk name is one nobody
 * finishes reading.
 *
 * The mirror-image rule matters just as much. Publishable keys — Stripe's
 * pk_live_, a Supabase anon key, any NEXT_PUBLIC_ value — are DESIGNED to ship
 * in a browser bundle. Reporting one as a leak is confidently wrong in the most
 * visible way possible: the reader knows it is fine, and stops believing the
 * rest of the report.
 */

export interface SecretMatch {
  kind: string
  /** Redacted. The real value never leaves the check. */
  sample: string
  severity: 'critical' | 'high'
  /** What the holder of this key can do. */
  impact: string
}

interface SecretPattern {
  kind: string
  pattern: RegExp
  severity: 'critical' | 'high'
  impact: string
}

const PATTERNS: readonly SecretPattern[] = [
  {
    kind: 'AWS access key id',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: 'critical',
    impact: 'whatever the IAM policy allows, which on a leaked root-adjacent key is everything',
  },
  {
    kind: 'Stripe secret key',
    pattern: /\bsk_live_[0-9a-zA-Z]{20,}/g,
    severity: 'critical',
    impact: 'charging cards, issuing refunds and reading every customer record',
  },
  {
    kind: 'Stripe restricted key',
    pattern: /\brk_live_[0-9a-zA-Z]{20,}/g,
    severity: 'high',
    impact: 'whatever the restricted key was scoped to',
  },
  {
    kind: 'GitHub personal access token',
    pattern: /\b(ghp_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{50,})\b/g,
    severity: 'critical',
    impact: 'read and usually write access to the repositories that account can reach',
  },
  {
    kind: 'Google API key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    severity: 'high',
    impact: 'billable API usage on the owning project, unless the key is referrer-restricted',
  },
  {
    kind: 'Slack token',
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}/g,
    severity: 'critical',
    impact: 'reading and posting in the workspace the token belongs to',
  },
  {
    kind: 'SendGrid API key',
    pattern: /\bSG\.[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{30,}/g,
    severity: 'high',
    impact: 'sending mail as the domain, which is a phishing platform with the sender already trusted',
  },
  {
    kind: 'Anthropic API key',
    pattern: /\bsk-ant-[0-9A-Za-z_-]{20,}/g,
    severity: 'critical',
    impact: 'billable model usage on the owning account',
  },
  {
    kind: 'OpenAI project key',
    pattern: /\bsk-proj-[0-9A-Za-z_-]{20,}/g,
    severity: 'critical',
    impact: 'billable model usage on the owning account',
  },
  {
    kind: 'Private key block',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    severity: 'critical',
    impact: 'impersonating whatever that key authenticates — a server, a user, a signing identity',
  },
]

/** A JWT, structurally. Used to find Supabase service-role keys, below. */
const JWT = /\beyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/g

/**
 * Shows enough to find the string in a bundle, and not enough to use it.
 * Evidence is stored in our database and rendered on a shareable page, so a
 * finding that quoted the key in full would publish it a second time.
 */
function redact(value: string): string {
  const head = value.slice(0, 10)
  return `${head}…(${value.length} chars)`
}

/**
 * Supabase ships two keys that look identical to a regex and are opposites in
 * effect: the anon key belongs in a browser, and the service-role key bypasses
 * every row-level security policy in the project. They are distinguishable
 * exactly, not heuristically — the role is a claim inside the JWT payload — so
 * this decodes rather than guesses.
 */
function findServiceRoleKeys(source: string): SecretMatch[] {
  const matches: SecretMatch[] = []

  for (const [token] of source.matchAll(JWT)) {
    const payload = token.split('.')[1]
    if (!payload) continue
    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
      if (decoded['role'] !== 'service_role') continue // the anon key belongs here
      matches.push({
        kind: 'Supabase service-role key',
        sample: redact(token),
        severity: 'critical',
        impact:
          'full read and write access to every table, bypassing every row-level security policy in the project',
      })
    } catch {
      // Not a JWT we can read. Guessing about it would be worse than silence.
    }
  }

  return matches
}

/** Every credential in `source`, deduplicated, redacted, worst kinds included. */
export function findSecrets(source: string): SecretMatch[] {
  const found = new Map<string, SecretMatch>()

  for (const { kind, pattern, severity, impact } of PATTERNS) {
    for (const [value] of source.matchAll(pattern)) {
      const sample = redact(value)
      if (!found.has(sample)) found.set(sample, { kind, sample, severity, impact })
    }
  }

  for (const match of findServiceRoleKeys(source)) {
    if (!found.has(match.sample)) found.set(match.sample, match)
  }

  return [...found.values()]
}
