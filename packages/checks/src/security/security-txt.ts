/**
 * /.well-known/security.txt (RFC 9116) — the machine-readable answer to "who do
 * I tell?" when someone finds a flaw. Its absence is a disclosure-hygiene
 * signal, not a vulnerability, so it stays at low; a file that exists but has
 * expired or names no contact is the louder finding, because RFC 9116 tells
 * consumers to treat a stale file as unusable — the site looks prepared while
 * the advertised channel is one nobody is obliged to watch.
 *
 * Deliberately narrow: one probe, at the canonical well-known path only. The
 * legacy top-level /security.txt is never fetched, so every finding here is
 * worded as a statement about that one path. Contact values are not validated
 * as URIs either — a bare email address is off-spec but is still a channel a
 * human reads, and calling that "no contact" would be a false positive.
 *
 * `probe()` resolves to null on network failure or when the per-scan probe cap
 * is spent. Null means "unknown", never "missing".
 */

import type { Check, CheckContext, Finding } from '../types.ts'

const ID = 'security.security-txt'

const PATH = '/.well-known/security.txt'

/**
 * The RFC 9116 field names, used only to answer "is this response a security.txt
 * at all". Without the test, a catch-all route answering 200 with the app shell
 * reads as a published file — the same trap the sitemap check guards against.
 */
const KNOWN_FIELDS = new Set([
  'acknowledgments',
  'canonical',
  'contact',
  'csaf',
  'encryption',
  'expires',
  'hiring',
  'policy',
  'preferred-languages',
])

export const securityTxtCheck: Check = {
  id: ID,
  category: 'security',
  title: 'security.txt',

  async run(ctx) {
    const response = await ctx.probe(PATH)
    if (!response) return [] // unreachable or probe cap spent — unknown, not evidence of absence

    const url = new URL(PATH, ctx.finalUrl).href
    if (response.status !== 200) return notPublished(url, `answered HTTP ${response.status}`, response)

    // Shape before content: an HTML body is a catch-all route answering the path,
    // whatever stray "Field: value" text the markup happens to contain.
    if (isHtml(response.body)) return appShell(url, response)

    const fields = parseFields(response.body)
    if (fields.size === 0) {
      return notPublished(url, 'answered 200, but its body carries no RFC 9116 field', response)
    }

    return inspect(url, fields)
  },
}

/** Nothing usable at the well-known path — the mildest finding this check makes. */
function notPublished(url: string, observed: string, response: Probe): Finding[] {
  return [
    {
      checkId: ID,
      category: 'security',
      severity: 'low',
      title: 'No security.txt',
      description:
        `${url} ${observed}, so the site publishes no machine-readable contact point for security ` +
        'reports. Someone who finds a flaw has to guess — a support form, an address they hope is ' +
        'monitored, or a public post — and reports routinely stall or go public instead of reaching ' +
        'the people who can fix them.',
      evidence: { probed: url, status: response.status, contentType: response.headers.get('content-type') },
      remediation:
        `Publish ${PATH} with at least Contact: and Expires: fields, served as text/plain.`,
      fixPrompt:
        `Add a security.txt to this site at ${PATH}, served as text/plain, containing:\n\n` +
        'Contact: mailto:security@<domain>\nExpires: <an ISO 8601 timestamp under a year out>\n' +
        'Policy: <URL of the disclosure policy, if one exists>\n\nServe it from the framework route or ' +
        'the static public directory, use an address a person actually monitors, and put a calendar ' +
        'reminder on the Expires date.',
    } satisfies Finding,
  ]
}

/**
 * 200 + HTML: a catch-all route is answering the path. Same score as absence,
 * but a different fix, so it gets its own wording rather than being folded in.
 */
function appShell(url: string, response: Probe): Finding[] {
  return [
    {
      checkId: ID,
      category: 'security',
      severity: 'low',
      title: 'security.txt path returns an HTML page',
      description:
        `${url} answers 200 with an HTML document — a catch-all or SPA route serving the app shell, ` +
        'not a security.txt. Tools that parse the file find no fields, while any monitoring that only ' +
        'looks at the status code reports the path as healthy.',
      evidence: {
        probed: url,
        contentType: response.headers.get('content-type'),
        snippet: response.body.slice(0, 200),
      },
      remediation: `Serve a real text/plain security.txt at ${PATH} and exclude the path from the catch-all route.`,
      fixPrompt:
        `${url} serves HTML because a catch-all/SPA route handles it. Serve a text/plain RFC 9116 ` +
        'security.txt at that exact path instead (Contact: and Expires: fields at minimum) and exclude ' +
        'the path from the rewrite rules.',
    } satisfies Finding,
  ]
}

/**
 * A real security.txt. One finding at most: the file is a single small artifact,
 * and charging it three times for three off-spec lines would outweigh the
 * penalty for publishing nothing at all. Worst problem wins; the rest ride along
 * as evidence.
 */
function inspect(url: string, fields: Map<string, string[]>): Finding[] {
  const contacts = fields.get('contact') ?? []
  const expiresRaw = fields.get('expires')?.[0] ?? null
  const expiresAt = expiresRaw ? parseTimestamp(expiresRaw) : null
  const evidence = {
    securityTxt: url,
    fields: [...fields.keys()],
    contacts,
    expires: expiresRaw,
  }

  if (contacts.length === 0) {
    return [
      {
        checkId: ID,
        category: 'security',
        severity: 'medium',
        title: 'security.txt has no Contact address',
        description:
          'The file is published but carries no usable Contact: value, the one field RFC 9116 requires. ' +
          'It lists everything except where to send a report, so parsers reject it and a researcher ' +
          'reading it by hand ends up back at guesswork — while the site looks like it has a ' +
          'disclosure process.',
        evidence,
        remediation: `Add a Contact: line with a monitored address or URL, e.g. Contact: mailto:security@${hostOf(url)}.`,
        fixPrompt:
          `This site's ${PATH} has no usable Contact: value. Add one as the first field — ` +
          '"Contact: mailto:security@<domain>" (or an https: URL of a report form) — pointing at an ' +
          'inbox someone monitors. Keep the existing fields.',
      } satisfies Finding,
    ]
  }

  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return [
      {
        checkId: ID,
        category: 'security',
        severity: 'medium',
        title: `security.txt expired on ${expiresAt.toISOString().slice(0, 10)}`,
        description:
          `The Expires field reads ${expiresRaw}, which is in the past. RFC 9116 says consumers must ` +
          'treat such a file as stale and should not use it, so the contact it lists is skipped by ' +
          'tooling — and an expired file is a sign the process behind it stopped, which is worse than ' +
          'never having published one.',
        evidence,
        remediation: 'Confirm the listed contacts are still monitored, then set Expires: to a date under a year away.',
        fixPrompt:
          `This site's ${PATH} has an Expires value in the past (${expiresRaw}). Verify the Contact ` +
          'addresses still reach the security owner, then update Expires: to an ISO 8601 timestamp less ' +
          'than a year in the future, and add a recurring reminder to refresh it before it lapses.',
      } satisfies Finding,
    ]
  }

  if (expiresRaw && !expiresAt) {
    return [
      {
        checkId: ID,
        category: 'security',
        severity: 'low',
        title: 'security.txt Expires value is not a parseable timestamp',
        description:
          `The Expires field reads ${expiresRaw}, which does not parse as a date. RFC 9116 requires an ` +
          'ISO 8601 timestamp here, so strict parsers reject the file — and neither they nor this scan ' +
          'can tell whether the contact details are still current.',
        evidence,
        remediation: 'Rewrite Expires: as an ISO 8601 timestamp, e.g. Expires: 2027-01-31T00:00:00.000Z.',
        fixPrompt:
          `This site's ${PATH} has an unparseable Expires value (${expiresRaw}). Replace it with an ` +
          'ISO 8601 / RFC 3339 timestamp less than a year in the future, e.g. "2027-01-31T00:00:00.000Z".',
      } satisfies Finding,
    ]
  }

  if (!expiresRaw) {
    return [
      {
        checkId: ID,
        category: 'security',
        severity: 'low',
        title: 'security.txt has no Expires field',
        description:
          'RFC 9116 requires Expires:, and it is the only signal that the file is still maintained. ' +
          'Without it nobody reading the file — a researcher or a parser — can tell whether the ' +
          'addresses are still monitored or were left behind years ago.',
        evidence,
        remediation: 'Add an Expires: line with an ISO 8601 timestamp less than a year away, and refresh it on that date.',
        fixPrompt:
          `This site's ${PATH} is missing the required Expires: field. Add "Expires: <ISO 8601 ` +
          'timestamp under a year out>" and set a recurring reminder to review the contacts and push ' +
          'the date forward before it lapses.',
      } satisfies Finding,
    ]
  }

  return []
}

/**
 * RFC 9116 is line-based "Field: value", with # comments. Signed files wrap the
 * same lines in PGP cleartext, so parsing stops at the signature armor — its
 * headers (Version:, Comment:) are not security.txt fields and its base64 is
 * not worth scanning.
 */
function parseFields(body: string): Map<string, string[]> {
  const fields = new Map<string, string[]>()

  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('-----BEGIN PGP SIGNATURE-----')) break

    const match = line.match(/^([A-Za-z][A-Za-z-]*)\s*:\s*(.+)$/)
    if (!match) continue

    // Both groups are guaranteed by the pattern; the guard is what strict
    // indexed access accepts in place of a non-null assertion.
    const [, rawName, rawValue] = match
    if (!rawName || !rawValue) continue

    const name = rawName.toLowerCase()
    const value = rawValue.trim()
    if (!KNOWN_FIELDS.has(name) || value === '') continue

    const existing = fields.get(name)
    if (existing) existing.push(value)
    else fields.set(name, [value])
  }

  return fields
}

/** Date.parse is lenient by design here: an off-spec but readable date is still a date. */
function parseTimestamp(value: string): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isHtml(body: string): boolean {
  return /^\s*<(!doctype|html)\b/i.test(body)
}

function hostOf(url: string): string {
  return new URL(url).hostname
}

type Probe = NonNullable<Awaited<ReturnType<CheckContext['probe']>>>
