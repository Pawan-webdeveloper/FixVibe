/**
 * SPF — the TXT record naming which servers may send mail for a domain. With
 * no usable record, anyone can put the domain in an envelope sender and no
 * receiver has a mechanical reason to refuse the message.
 *
 * Deliberately narrow, because every one of these findings is about a name the
 * page itself never mentions:
 *  - Silent when the organizational domain is undecidable (first branch below).
 *  - `~all` is never reported. Softfail is the ordinary, considered choice on a
 *    large share of well-run domains; calling it a defect would be pure noise.
 *  - Includes are not followed — a check is a pure function over the context and
 *    has no resolver of its own. The 10-lookup limit is therefore reported only
 *    when the record's own terms already breach it, which expansion can only
 *    make worse.
 *  - Whether the domain sends mail at all is not considered: spoofing works
 *    against silent domains too, and ctx.dns.mx belongs to the scanned
 *    hostname, which need not be the mail domain.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'security.email.spf'

/** A TXT value is an SPF record only when it opens with the version token. */
const SPF_VERSION = /^v=spf1(\s|$)/i

/** The `all` mechanism, capturing its qualifier — absent means "+", per RFC 7208 §4.6.2. */
const ALL_MECHANISM = /^([-+~?]?)all$/i

/**
 * Terms that cost a DNS lookup: the include/a/mx/ptr/exists mechanisms (each
 * with an optional qualifier) and the redirect modifier. `exp=` is excluded —
 * RFC 7208 §4.6.4 keeps it outside the limit.
 */
const LOOKUP_TERM = /^(?:[-+~?]?(?:include:|exists:|ptr(?::|$)|a(?:[:/]|$)|mx(?:[:/]|$))|redirect=)/i

/** RFC 7208 §4.6.4 — exceeding this many lookups in one evaluation is a PermError. */
const MAX_DNS_LOOKUPS = 10

export const spfCheck: Check = {
  id: ID,
  category: 'security',
  title: 'SPF record',

  run(ctx) {
    const { emailDomain, spfTxt } = ctx.dns

    // A null emailDomain means the organizational domain could not be derived
    // without a Public Suffix List, so no SPF lookup ever happened and spfTxt is
    // empty by construction. Reporting "no SPF record" for a name we never
    // queried is exactly the false positive this context field exists to
    // prevent, so this check has nothing to say.
    if (!emailDomain) return []

    // An 'unknown' spfTxt means the TXT query itself failed (timeout, SERVFAIL).
    // An empty answer proves absence; a failed query proves nothing, and "no
    // SPF record" off a dead resolver is precisely the false positive this
    // check must not emit — github.com and stripe.com both publish SPF.
    if (spfTxt === 'unknown') return []

    const [record, ...extraRecords] = spfTxt.filter((txt) => SPF_VERSION.test(txt.trim()))

    if (!record) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'medium',
          title: 'No SPF record',
          description:
            `No TXT record at ${emailDomain} starts with v=spf1, so no sending host is designated as ` +
            'authorised. A receiver has no mechanical basis to reject mail that claims to come from ' +
            'this domain, and DMARC loses one of the two ways it can align a message.',
          evidence: { domain: emailDomain, txtRecords: spfTxt },
          remediation:
            `Publish one TXT record at ${emailDomain} listing every service that sends mail for the ` +
            'domain and ending in ~all, e.g. "v=spf1 include:_spf.google.com ~all".',
          fixPrompt:
            `This domain (${emailDomain}) publishes no SPF record. Add a single TXT record at the ` +
            'domain apex of the form "v=spf1 <one include: or ip4: term per sending service> ~all". ' +
            'If DNS for this project is managed in the repository (zone file, Terraform, Pulumi, CDK), ' +
            'make the change there; otherwise output the exact record to add at the DNS provider. ' +
            'Enumerate the real senders first — a record that omits one silently starts failing its mail.',
        } satisfies Finding,
      ]
    }

    if (extraRecords.length > 0) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'medium',
          title: 'Multiple SPF records',
          description:
            `${extraRecords.length + 1} TXT records at ${emailDomain} start with v=spf1. RFC 7208 §4.5 ` +
            'makes that a PermError: receivers stop there and treat the domain as having no usable ' +
            'policy, so the setup looks configured while protecting nothing.',
          evidence: { domain: emailDomain, records: [record, ...extraRecords] },
          remediation:
            'Merge the mechanisms into a single v=spf1 TXT record and delete the others — a domain may ' +
            'publish only one.',
          fixPrompt:
            `This domain (${emailDomain}) publishes more than one SPF TXT record, which receivers treat ` +
            `as a PermError. The records are: ${[record, ...extraRecords].map((r) => `"${r}"`).join(', ')}. ` +
            'Merge their mechanisms into one "v=spf1 … ~all" record, keeping every distinct sender, and ' +
            'delete the rest. Update the zone file or DNS module in this repo if one manages these records.',
        } satisfies Finding,
      ]
    }

    const findings: Finding[] = []
    const terms = record.trim().split(/\s+/).slice(1) // drop the v=spf1 token
    const allIndex = terms.findIndex((term) => ALL_MECHANISM.test(term))
    const allTerm = allIndex === -1 ? null : (terms[allIndex] ?? null)
    const writtenQualifier = allTerm === null ? null : (ALL_MECHANISM.exec(allTerm)?.[1] ?? '')
    const qualifier = writtenQualifier === '' ? '+' : writtenQualifier

    if (qualifier === '+') {
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'high',
        title: `SPF record ends in ${allTerm}`,
        description:
          `"${allTerm}" passes every sender` +
          (writtenQualifier === '' ? ' — an all mechanism with no qualifier written means +all — ' : ', ') +
          `so the record authorises the whole internet to send as ${emailDomain}. Any host that puts ` +
          'the domain in the envelope sender earns an SPF pass, and that pass is aligned, so it ' +
          'satisfies DMARC too — a weaker position than publishing nothing.',
        evidence: { domain: emailDomain, record },
        remediation:
          `Replace ${allTerm} with ~all (softfail) or -all once the listed senders are known to be complete.`,
        fixPrompt:
          `This domain's SPF record is "${record}". The trailing "${allTerm}" mechanism authorises every ` +
          'sender on the internet; change it to "~all" (or "-all" once the sender list is verified ' +
          'complete) and make sure every real sending service is listed by an include: or ip4: term. ' +
          'Apply the change in the repo\'s DNS configuration if there is one, otherwise state the record to publish.',
      })
    } else if (qualifier === '?') {
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'low',
        title: 'SPF policy is neutral (?all)',
        description:
          '"?all" asserts nothing about senders that the record does not list, so a receiver handles ' +
          'them exactly as it would with no record at all. Listed senders still produce a pass that ' +
          'DMARC can align on, but there is nothing here to reject on.',
        evidence: { domain: emailDomain, record },
        remediation: 'Change ?all to ~all, or to -all once the list of senders is known to be complete.',
        fixPrompt:
          `This domain's SPF record is "${record}". Its "?all" qualifier makes no assertion about ` +
          'unlisted senders. Confirm every sending service appears in the record, then change "?all" to ' +
          '"~all" (softfail) and later "-all". Apply it in the repo\'s DNS configuration if one exists.',
      })
    } else if (allTerm === null && !terms.some((term) => /^redirect=/i.test(term))) {
      // With no `all` and no redirect= to hand the policy to another domain, the
      // evaluation falls off the end of the record — the default result is
      // neutral (RFC 7208 §4.7), i.e. the same non-answer as ?all.
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'info',
        title: 'SPF record has no "all" mechanism',
        description:
          'The record ends without an all mechanism and without a redirect modifier, so any sender it ' +
          'does not match gets the default result, neutral. In practice that is the same as ?all: ' +
          'receivers are told nothing about unlisted senders.',
        evidence: { domain: emailDomain, record },
        remediation: 'Append ~all to the record (or -all once the sender list is known to be complete).',
        fixPrompt:
          `This domain's SPF record is "${record}" and has no trailing all mechanism, so unlisted ` +
          'senders evaluate to neutral. Append "~all" as the final term, keeping the existing ' +
          'mechanisms in order, and apply it wherever this domain\'s DNS records are managed.',
      })
    }

    // Terms after `all` are unreachable — `all` always matches, so evaluation
    // never reaches them (and RFC 7208 §6.1 discards redirect= for that reason).
    const evaluated = allIndex === -1 ? terms : terms.slice(0, allIndex)
    const lookupTerms = evaluated.filter((term) => LOOKUP_TERM.test(term))

    // Only worth reporting when the record's own terms already exceed the cap:
    // that is provable from the text alone, since expanding an include can add
    // lookups but never remove them. A top-level count of 8 says nothing — one
    // include may hide six more — and we cannot follow includes from a check.
    if (lookupTerms.length > MAX_DNS_LOOKUPS) {
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'medium',
        title: 'SPF record exceeds the 10-lookup limit',
        description:
          `Counting only the terms written in this record — include, a, mx, ptr, exists and redirect — ` +
          `there are ${lookupTerms.length} that each cost a DNS lookup, against the limit of 10 in ` +
          'RFC 7208 §4.6.4. Includes expand into further lookups that are not counted here, so the real ' +
          'total is at least this. An evaluation that passes the tenth returns PermError, and receivers ' +
          'treat a PermError as no usable policy.',
        evidence: { domain: emailDomain, record, countedTerms: lookupTerms, limit: MAX_DNS_LOOKUPS },
        remediation:
          'Cut the record below 10 lookups: drop includes for services that no longer send, replace ' +
          'small includes with their ip4:/ip6: ranges, and remove any ptr mechanism.',
        fixPrompt:
          `This domain's SPF record is "${record}". It contains ${lookupTerms.length} DNS-lookup terms ` +
          'at the top level alone, over the RFC 7208 limit of 10, which makes evaluation return ' +
          'PermError. Reduce it: remove includes for services that no longer send mail, inline small ' +
          'includes as ip4:/ip6: ranges, and delete any ptr mechanism. Keep the trailing all qualifier ' +
          'as it is, and verify the remaining senders still pass.',
      })
    }

    return findings
  },
}
