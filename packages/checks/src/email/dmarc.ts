/**
 * DMARC — the policy record at `_dmarc.<domain>` that tells receiving mail
 * servers what to do with mail that fails SPF and DKIM, and where to send the
 * aggregate reports. SPF and DKIM only authenticate; DMARC is what turns a
 * failure into a rejection and what makes spoofing visible to the domain owner.
 *
 * This check grades the record the context already resolved, nothing more. It
 * deliberately does NOT decide whether the domain sends mail at all (an unused
 * domain is the easiest one to spoof, so the record matters either way), does
 * not check that anyone reads the `rua=` mailbox, and does not verify external
 * destination authorisation (RFC 7489 §7.1) — that needs lookups the context
 * does not perform. When `emailDomain` is null no lookup happened at all, so
 * the check stays silent rather than reporting on a name it never queried.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'security.email.dmarc'

/**
 * The version tag has to come first, and RFC 7489 §6.4 makes the literal
 * "DMARC1" case-sensitive. We match it case-insensitively on purpose: a record
 * that is plainly published must never be reported as "missing" over its
 * spelling. The exact casing is judged separately below, where we can state
 * what a conforming receiver does with it instead of hiding the record.
 */
const VERSION_TAG = /^\s*v\s*=\s*(dmarc1)\s*(?:;|$)/i

/** The only three policy values receivers act on. */
const POLICIES = new Set(['none', 'quarantine', 'reject'])

export const dmarcCheck: Check = {
  id: ID,
  category: 'security',
  title: 'DMARC record',

  run(ctx) {
    // No organizational domain means the `_dmarc` query was never made, so an
    // empty dmarcTxt tells us nothing about this domain. Silence, not a finding.
    const domain = ctx.dns.emailDomain
    if (!domain) return []

    const name = `_dmarc.${domain}`
    // TXT names routinely carry unrelated values (vendor verification tokens);
    // per RFC 7489 §6.6.3 anything without the version tag is not a candidate.
    const records = ctx.dns.dmarcTxt.filter((txt) => VERSION_TAG.test(txt))
    const [record] = records

    if (records.length > 1) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'medium',
          title: 'Multiple DMARC records published',
          description:
            `${records.length} TXT records at ${name} start with v=DMARC1. RFC 7489 §6.6.3 says a ` +
            'domain publishing more than one is treated as publishing none, so whatever policy is ' +
            'written here is applied by nobody — the configuration looks done and is inert.',
          evidence: { name, records },
          remediation: `Delete the extra TXT records at ${name} so exactly one DMARC record remains.`,
          fixPrompt:
            `The domain ${domain} has ${records.length} DMARC records at "${name}": ` +
            `${records.map((r) => JSON.stringify(r)).join(', ')}. Receivers treat that as no DMARC ` +
            'record at all. Merge them into one TXT record and delete the others in the DNS provider ' +
            "(or the repository's infrastructure-as-code DNS config, if there is one).",
        } satisfies Finding,
      ]
    }

    if (!record) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'medium',
          title: 'No DMARC record',
          description:
            `The TXT lookup at ${name} returned no record starting with v=DMARC1. Receiving servers ` +
            'therefore have no instruction for mail that fails SPF and DKIM, so forged mail from this ' +
            'domain is neither rejected nor reported — the domain owner cannot even see it happening.',
          evidence: { name, txtRecords: ctx.dns.dmarcTxt },
          remediation:
            `Publish a TXT record at ${name} starting with "v=DMARC1; p=none; rua=mailto:…", then ` +
            'tighten the policy once the reports show only unwanted mail failing.',
          fixPrompt:
            `The domain ${domain} has no DMARC record. Add a DNS TXT record at "${name}" with the ` +
            `value "v=DMARC1; p=none; rua=mailto:dmarc-reports@${domain}". This is a DNS change, not a ` +
            "code change — make it in the DNS provider or the repository's infrastructure-as-code DNS " +
            'config. Read the aggregate reports for a few weeks, fix any legitimate senders that fail, ' +
            'then raise p to quarantine and finally to reject.',
        } satisfies Finding,
      ]
    }

    // Group 1 always exists here — the record reached this line by matching
    // VERSION_TAG. The fallback keeps an impossible parse silent instead of
    // inventing a finding about a spelling we failed to read.
    const version = record.match(VERSION_TAG)?.[1] ?? 'DMARC1'
    if (version !== 'DMARC1') {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'low',
          title: `DMARC version tag is spelled "${version}"`,
          description:
            'RFC 7489 §6.4 requires the version value to match "DMARC1" exactly, and says a record ' +
            'whose value does not match must be ignored in full. Lenient receivers still read this ' +
            'record, so the policy may work in some places and be absent in others.',
          evidence: { name, record },
          remediation: `Rewrite the record at ${name} to begin with "v=DMARC1" in that exact casing.`,
          fixPrompt:
            `The DMARC TXT record at "${name}" is ${JSON.stringify(record)}. Its version tag is not the ` +
            'exact literal "DMARC1", which RFC 7489 requires. Edit the record in DNS so it starts with ' +
            '"v=DMARC1;" and leave the remaining tags unchanged.',
        } satisfies Finding,
      ]
    }

    const tags = parseTags(record)
    // Tag names are case-insensitive; policy values are lowercase in the ABNF
    // but arrive mixed-case often enough that treating "None" as invalid would
    // be a false positive rather than a finding.
    const policy = tags.get('p')?.toLowerCase()

    if (policy === undefined || !POLICIES.has(policy)) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'medium',
          title:
            policy === undefined
              ? 'DMARC record has no p= policy tag'
              : `DMARC record has an unrecognised policy (p=${policy})`,
          description:
            'p= is the required tag and carries the entire instruction to receivers. Without a value ' +
            'they recognise — none, quarantine or reject — the record is invalid and is treated the ' +
            'same as having no DMARC record at all.',
          evidence: { name, record },
          remediation: `Add a valid policy to the record at ${name}, e.g. "p=none" while you collect reports.`,
          fixPrompt:
            `The DMARC TXT record at "${name}" is ${JSON.stringify(record)} and has no usable p= tag. ` +
            'Edit it in DNS so it reads "v=DMARC1; p=none; rua=mailto:…" (keep any existing rua/ruf ' +
            'addresses), then raise p to quarantine and reject once the reports look clean.',
        } satisfies Finding,
      ]
    }

    const findings: Finding[] = []
    const rua = tags.get('rua')
    const hasRua = rua !== undefined && rua.length > 0
    const enforcing = policy === 'quarantine' || policy === 'reject'

    if (policy === 'none') {
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'low',
        title: 'DMARC policy is monitor-only (p=none)',
        description:
          'p=none asks receivers to deliver failing mail as usual, so nothing forging this domain is ' +
          'stopped yet. That is the correct first stage of a rollout — the record collects evidence ' +
          'while legitimate senders are fixed — but it is not protection until the policy is raised.' +
          (hasRua
            ? ''
            : ' No rua= address is set either, so the aggregate reports that would justify raising it ' +
              'are not being delivered anywhere and the record currently has no effect at all.'),
        evidence: { name, record },
        remediation: hasRua
          ? 'Work through the aggregate reports, then move the policy to quarantine and on to reject.'
          : 'Add an rua= address, then move the policy to quarantine and on to reject once reports are clean.',
        fixPrompt:
          `The DMARC record at "${name}" is ${JSON.stringify(record)} — policy p=none, which enforces ` +
          `nothing.${hasRua ? '' : ' It also has no rua= address, so no reports are being collected.'} ` +
          `In DNS, ${hasRua ? '' : `add "rua=mailto:dmarc-reports@${domain}" and `}confirm every ` +
          'legitimate sender passes SPF or DKIM, then change p to quarantine and finally to reject.',
      })
    } else if (!hasRua) {
      // Only worth its own finding when a policy is actually being applied; for
      // p=none the same gap is already described above.
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'low',
        title: 'DMARC record has no rua= reporting address',
        description:
          `The policy is p=${policy}, so receivers are acting on failures, but with no rua= address ` +
          'the aggregate reports go nowhere. Legitimate mail that starts failing — a new sending ' +
          'service, a rotated DKIM key — is then quarantined or rejected with no signal to anyone here.',
        evidence: { name, record },
        remediation: `Add rua=mailto:<address> to the record at ${name} and review the reports regularly.`,
        fixPrompt:
          `The DMARC record at "${name}" is ${JSON.stringify(record)} and has no rua= tag, so nobody ` +
          `receives aggregate reports. Add "rua=mailto:dmarc-reports@${domain}" to the record in DNS ` +
          '(a mailbox or a DMARC reporting service), keeping the existing policy unchanged.',
      })
    }

    const pct = parsePct(tags.get('pct'))
    if (enforcing && pct !== null && pct < 100) {
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'info',
        title: `DMARC policy applies to ${pct}% of failing mail (pct=${pct})`,
        description:
          `The record sets p=${policy} with pct=${pct}, so receivers apply that policy to roughly ` +
          `${pct}% of messages that fail and fall back to the weaker treatment for the rest. Staged ` +
          'rollouts do exactly this; it is worth confirming the staging was finished on purpose.',
        evidence: { name, record, pct },
        remediation: 'Raise pct to 100 (or drop the tag) once the reports show only unwanted mail failing.',
        fixPrompt:
          `The DMARC record at "${name}" is ${JSON.stringify(record)}. If the staged rollout is ` +
          'complete, remove the pct tag (100 is the default) so the policy applies to all failing mail.',
      })
    }

    if (enforcing && tags.get('sp')?.toLowerCase() === 'none') {
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'low',
        title: 'Subdomains are exempt from the DMARC policy (sp=none)',
        description:
          `The organizational domain is at p=${policy}, but sp=none tells receivers to apply no policy ` +
          `to mail from subdomains. Anything claiming to come from a subdomain of ${domain} — including ` +
          'names that have never existed — is delivered as usual, which is the easier address to forge.',
        evidence: { name, record },
        remediation:
          'Remove the sp tag so subdomains inherit p, or set sp explicitly, unless one subdomain ' +
          'still needs the exemption.',
        fixPrompt:
          `The DMARC record at "${name}" is ${JSON.stringify(record)}: the domain enforces p=${policy} ` +
          'while sp=none leaves every subdomain unprotected. Unless a specific subdomain is mid-rollout, ' +
          `remove the sp tag in DNS so subdomains inherit p=${policy}.`,
      })
    }

    return findings
  },
}

/**
 * Tag list per RFC 7489 §6.4: `tag=value` pairs separated by ";", whitespace
 * allowed around both. Tag names are case-insensitive. A repeated tag keeps the
 * first value, matching receivers that parse left to right and stop.
 */
function parseTags(record: string): Map<string, string> {
  const tags = new Map<string, string>()
  for (const part of record.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    const key = part.slice(0, separator).trim().toLowerCase()
    const value = part.slice(separator + 1).trim()
    if (key.length > 0 && !tags.has(key)) tags.set(key, value)
  }
  return tags
}

/** null for absent or malformed values — a pct we cannot read is not a finding. */
function parsePct(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,3}$/.test(raw)) return null
  const pct = Number(raw)
  return pct <= 100 ? pct : null
}
