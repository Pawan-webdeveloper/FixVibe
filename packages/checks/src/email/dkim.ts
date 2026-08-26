/**
 * DKIM — the public keys a domain publishes so receivers can verify that mail
 * claiming to come from it was really signed by its mail servers.
 *
 * The hard truth about auditing DKIM from outside: **selectors cannot be
 * enumerated.** A selector is an arbitrary label chosen by whoever signs the
 * mail, published at `<selector>._domainkey.<domain>`, and DNS offers no way
 * to list the names under a node. The only reliable way to learn a selector is
 * to read the DKIM-Signature header of a message the domain actually sent.
 *
 * So this check works from a curated list of the selectors big providers use
 * by default (see context/dns.ts), and everything it says is phrased to match
 * what that can prove. Finding nothing means "none of the selectors we know
 * of" — never "no DKIM". A scanner that reported the latter would tell a
 * correctly configured customer their mail was unprotected, and be wrong.
 *
 * Two further traps this check has to survive:
 *   - A wildcard `*._domainkey` makes every selector "resolve". example.com
 *     does exactly this. The context detects it with a control query and hands
 *     us `wildcard` instead of eighteen imaginary keys.
 *   - `p=` with an empty value is a REVOKED key (RFC 6376 §3.6.1), not a
 *     broken one. A domain that publishes only revoked keys is usually stating
 *     "this domain does not send mail", which is a correct thing to do.
 */

import type { Check, CheckContext, Finding } from '../types.ts'

const ID = 'security.email.dkim'

export const dkimCheck: Check = {
  id: ID,
  category: 'security',
  title: 'DKIM signing keys',

  run(ctx) {
    // No organizational domain means no `_domainkey` query was ever made.
    const domain = ctx.dns.emailDomain
    if (!domain) return []

    const { selectors, wildcard } = ctx.dns.dkim

    if (wildcard) return wildcardFindings(domain, wildcard)

    const names = Object.keys(selectors)
    if (names.length === 0) return sendsMail(ctx) ? [noKnownSelectorFinding(ctx, domain)] : []

    const findings: Finding[] = []
    const live = names.filter((selector) => hasKey(selectors[selector] ?? []))

    if (live.length === 0 && sendsMail(ctx)) {
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'medium',
        title: 'Every DKIM key found is revoked',
        description:
          `${names.length} selector(s) under _domainkey.${domain} publish a DKIM record with an empty ` +
          'p= value, which RFC 6376 §3.6.1 defines as a revoked key — receivers must treat any ' +
          'signature made with it as failing. This domain does accept or send mail (it has MX or SPF ' +
          'records), so either signing was turned off and the records left behind, or a key rotation ' +
          'published the new record in the wrong place.',
        evidence: { domain, selectors: recordsFor(selectors, names) },
        remediation:
          `Publish the current public key at its selector under _domainkey.${domain}, or remove the ` +
          'revoked records if this domain genuinely does not sign mail.',
        fixPrompt:
          `Every DKIM record found for ${domain} has an empty p= tag, i.e. a revoked key: ` +
          `${JSON.stringify(recordsFor(selectors, names))}. This is a DNS change, not a code change.\n\n` +
          'In the mail provider (Google Workspace, Microsoft 365, SendGrid, Postmark, SES, …) ' +
          'generate or re-copy the DKIM public key and publish it as a TXT record at the selector the ' +
          `provider gives you, under _domainkey.${domain}. Then send a test message and confirm the ` +
          'Authentication-Results header shows dkim=pass. If this domain does not send mail at all, ' +
          'delete the leftover records instead and make sure SPF and DMARC say so.',
      })
    }

    const testing = live.filter((selector) => inTestMode(selectors[selector] ?? []))
    if (testing.length > 0) {
      findings.push({
        checkId: ID,
        category: 'security',
        severity: 'low',
        title: `DKIM selector${testing.length > 1 ? 's are' : ' is'} in test mode (t=y)`,
        description:
          `The DKIM record${testing.length > 1 ? 's' : ''} at ${testing
            .map((selector) => `${selector}._domainkey.${domain}`)
            .join(', ')} carr${testing.length > 1 ? 'y' : 'ies'} the t=y flag. RFC 6376 §3.6.1 tells ` +
          'receivers that the domain is still testing, so they must not treat a failed signature any ' +
          'differently from unsigned mail. DMARC enforcement built on this key therefore does nothing ' +
          'until the flag is removed — the setup looks complete and is inert.',
        evidence: { domain, selectors: recordsFor(selectors, testing) },
        remediation:
          `Remove the t=y flag from the DKIM record${testing.length > 1 ? 's' : ''} once signed mail ` +
          'is verifying correctly.',
        fixPrompt:
          `The DKIM record(s) ${JSON.stringify(recordsFor(selectors, testing))} for ${domain} include ` +
          'the t=y test flag, so receivers ignore signature failures. This is a DNS change, not a code ' +
          'change. Confirm outgoing mail is verifying (the Authentication-Results header of a received ' +
          'test message should show dkim=pass), then edit the TXT record(s) to drop the "t=y" tag, ' +
          'leaving v, k and p unchanged.',
      })
    }

    return findings
  },
}

/**
 * A wildcard under `_domainkey` answers for every name, so no individual
 * selector can be verified. `p=` empty across the board is the documented way
 * to say "this domain signs nothing" and is reported as nothing at all.
 */
function wildcardFindings(domain: string, wildcard: string[]): Finding[] {
  if (!hasKey(wildcard)) return []

  return [
    {
      checkId: ID,
      category: 'security',
      severity: 'low',
      title: 'A wildcard DKIM key answers for every selector',
      description:
        `A wildcard record at *._domainkey.${domain} publishes a usable public key, so every possible ` +
        'selector — including ones that were never configured and ones that were meant to be retired ' +
        '— resolves to it. Selectors exist so a key can be rotated or revoked on its own; a wildcard ' +
        'removes that, and a key that leaks cannot be withdrawn without taking all signing down.',
      evidence: { domain, wildcard },
      remediation:
        `Publish the key at its own selector under _domainkey.${domain} and remove the wildcard record.`,
      fixPrompt:
        `The domain ${domain} serves a DKIM key from a wildcard record at "*._domainkey.${domain}": ` +
        `${JSON.stringify(wildcard)}. This is a DNS change, not a code change. Publish the same key at ` +
        'the specific selector the mail provider issued (e.g. "google._domainkey" or ' +
        '"s1._domainkey"), confirm a test message still shows dkim=pass, then delete the wildcard ' +
        'record so keys can be rotated one selector at a time.',
    },
  ]
}

function noKnownSelectorFinding(ctx: CheckContext, domain: string): Finding {
  return {
    checkId: ID,
    category: 'security',
    // Deliberately info (zero score impact). We cannot enumerate selectors, so
    // this is an "unable to confirm", and an unconfirmable negative must never
    // cost a correctly configured domain points.
    severity: 'info',
    title: 'No DKIM key found at any well-known selector',
    description:
      `${domain} accepts or sends mail — it publishes MX and/or SPF records — but none of the common ` +
      'provider selectors we test carries a DKIM key. DKIM selectors are arbitrary labels and cannot ' +
      'be listed from outside DNS, so this is NOT proof that DKIM is missing: a custom selector would ' +
      'look exactly like this. It is worth confirming directly, because without DKIM a DMARC policy ' +
      'passes only on SPF, and SPF breaks whenever mail is forwarded.',
    evidence: { domain, mx: ctx.dns.mx, spfTxt: ctx.dns.spfTxt },
    remediation:
      'Send a message from this domain to a mailbox you control and read the Authentication-Results ' +
      'header. If it does not say dkim=pass, enable DKIM signing in the mail provider and publish the ' +
      'record it gives you.',
    fixPrompt:
      `No DKIM key was found for ${domain} at any of the selectors used by the common mail providers, ` +
      'though the domain does have MX and/or SPF records. Selectors cannot be enumerated over DNS, so ' +
      'verify before changing anything: send a message from this domain to a mailbox you control and ' +
      'check the Authentication-Results header for "dkim=pass".\n\n' +
      'If it passes, there is nothing to do — the domain uses a custom selector. If it does not, ' +
      'enable DKIM in the mail provider and publish the TXT record it generates at ' +
      `<selector>._domainkey.${domain}. This is a DNS change, not a code change.`,
  }
}

/**
 * Whether the domain has anything to do with mail. Without this gate the
 * "no known selector" note would appear on every parked domain and every
 * project that has never sent an email, which is noise, not a finding.
 */
function sendsMail(ctx: CheckContext): boolean {
  // `v=spf1 -all` with no mechanisms is a domain stating that NOTHING may send
  // mail as it. Publishing a revoked DKIM key alongside that is the correct
  // configuration (RFC 6376 §3.6.1), not a rotation that went wrong, and a
  // receive-only domain that left one behind after leaving a provider would
  // otherwise be told at medium severity that its signing is broken.
  const declaresNoSender = ctx.dns.spfTxt.some((txt) => /^\s*v\s*=\s*spf1\s+-all\s*$/i.test(txt.trim()))
  if (declaresNoSender) return false

  return ctx.dns.mx.length > 0 || ctx.dns.spfTxt.some((txt) => /^\s*v\s*=\s*spf1\b/i.test(txt))
}

/** A record with a non-empty p= tag. Empty p= is a revoked key, not a broken one. */
function hasKey(records: readonly string[]): boolean {
  return records.some((record) => (tags(record).get('p') ?? '') !== '')
}

/** The t= tag is a colon-separated flag list; "y" means the domain is still testing. */
function inTestMode(records: readonly string[]): boolean {
  return records.some((record) =>
    (tags(record).get('t') ?? '')
      .split(':')
      .map((flag) => flag.trim().toLowerCase())
      .includes('y'),
  )
}

/** `tag=value` pairs separated by ";" (RFC 6376 §3.2); first value of a repeated tag wins. */
function tags(record: string): Map<string, string> {
  const parsed = new Map<string, string>()
  for (const part of record.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    const key = part.slice(0, separator).trim().toLowerCase()
    const value = part.slice(separator + 1).trim()
    if (key.length > 0 && !parsed.has(key)) parsed.set(key, value)
  }
  return parsed
}

/**
 * Selector → records, for evidence. DKIM public keys are public by definition,
 * so unlike the secrets checks there is nothing here to redact.
 */
function recordsFor(selectors: Record<string, string[]>, names: readonly string[]): Record<string, string[]> {
  return Object.fromEntries(names.map((name) => [name, selectors[name] ?? []]))
}
