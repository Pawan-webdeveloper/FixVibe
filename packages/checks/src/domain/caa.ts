/**
 * CAA — the DNS record set that names which Certificate Authorities are
 * allowed to issue certificates for a domain (RFC 8659). Every publicly
 * trusted CA is contractually required to check it before issuing.
 *
 * Why it matters: TLS trusts ~90 root programs equally, so without CAA any one
 * of them — or anyone who compromises one, or who talks one into a
 * mis-issuance — can mint a valid certificate for your domain and nothing
 * technically prevents it. CAA turns "any CA may issue" into "these may".
 *
 * This check reads `ctx.dns.caa`, which is the set found by the RFC's tree
 * climb, not a single query. That distinction is the whole reason this check
 * is trustworthy: `www.example.com` usually has no CAA of its own and inherits
 * `example.com`'s, so a naive one-shot lookup would report "no CAA" on most of
 * the well-configured web. When the climb could not complete, the context
 * hands us null and we say nothing.
 */

import type { Check, CheckContext, Finding } from '../types.ts'

const ID = 'security.domain.caa'

/** `issue "ca.example"` / `issuewild ";"` / `iodef "mailto:…"`. */
const PROPERTY = /^(issue|issuewild|iodef)\s+"(.*)"$/

interface CaaProperties {
  issue: string[]
  issuewild: string[]
  iodef: string[]
}

export const caaCheck: Check = {
  id: ID,
  category: 'security',
  title: 'CAA record',

  run(ctx) {
    const caa = ctx.dns.caa
    // null means the climb hit a resolver failure, so we do not know what
    // governs issuance here. A guess would be a finding about nothing.
    if (!caa) return []

    if (caa.records.length === 0) return [noCaaFinding(ctx)]

    const properties = parseProperties(caa.records)
    const recognised = properties.issue.length + properties.issuewild.length + properties.iodef.length
    // Records exist but none of them parsed. We are looking at a CAA set we
    // cannot read, so we know neither that issuance is allowed nor that it is
    // blocked — and "your certificates will stop renewing" is far too loud a
    // thing to say off a parse failure.
    if (recognised === 0) return []

    const authorized = [...properties.issue, ...properties.issuewild].filter((value) => value !== '')

    // A non-empty CAA set that names no CA forbids issuance outright (RFC 8659
    // §3): the empty issuer-domain-name `;` authorizes nobody, and a set with
    // only `iodef` has no `issue` property to authorize anybody either. This
    // is rare, and when it happens it is usually an accident that surfaces as
    // a failed renewal months later.
    if (authorized.length === 0) return [issuanceBlockedFinding(ctx, caa, properties)]

    return []
  },
}

function noCaaFinding(ctx: CheckContext): Finding {
  const host = ctx.finalUrl.hostname
  return {
    checkId: ID,
    category: 'security',
    severity: 'low',
    title: 'No CAA record',
    description:
      `No name from ${host} up to the registrable domain publishes a CAA record, so every publicly ` +
      'trusted Certificate Authority is permitted to issue certificates for this domain. A ' +
      'mis-issuance by any one of them — or by anyone who compromises or socially engineers one — ' +
      'produces a certificate browsers accept, and nothing in DNS objects.',
    evidence: { host, checked: 'CAA at the hostname and every parent up to the registrable domain' },
    remediation:
      'Publish a CAA record naming only the CA you actually use, plus an iodef address so ' +
      'attempted violations are reported to you.',
    fixPrompt:
      `The domain ${host} publishes no CAA record, so any Certificate Authority may issue ` +
      'certificates for it. This is a DNS change, not a code change — make it in the DNS provider ' +
      "(or the repository's infrastructure-as-code DNS config, if there is one).\n\n" +
      'First confirm which CA actually issues the current certificate and any others in use ' +
      '(Let\'s Encrypt via a host like Vercel/Netlify/Cloudflare, or a commercial CA). Then add CAA ' +
      `records at ${host}, for example:\n\n` +
      '  CAA 0 issue "letsencrypt.org"\n' +
      '  CAA 0 issuewild "letsencrypt.org"\n' +
      `  CAA 0 iodef "mailto:security@${host}"\n\n` +
      'Do not guess the issuer: a CAA record that omits the CA in use will break the next ' +
      'certificate renewal. Include every CA that legitimately issues for this domain, including ' +
      'any used by a CDN or load balancer in front of the site.',
  }
}

function issuanceBlockedFinding(
  ctx: CheckContext,
  caa: NonNullable<CheckContext['dns']['caa']>,
  properties: CaaProperties,
): Finding {
  const host = ctx.finalUrl.hostname
  const onlyIodef = properties.issue.length === 0 && properties.issuewild.length === 0
  // A live certificate proves this configuration is already at odds with
  // reality: something issued one, and the next renewal will not.
  const hasCertificate = ctx.tls !== null

  return {
    checkId: ID,
    category: 'security',
    severity: hasCertificate ? 'high' : 'medium',
    title: 'CAA record forbids all certificate issuance',
    description:
      `The CAA set at ${caa.name} authorizes no Certificate Authority: ` +
      (onlyIodef
        ? 'it contains only an iodef reporting address and no issue property, '
        : 'every issue/issuewild property names the empty issuer ";", ') +
      'which RFC 8659 reads as "no CA may issue for this domain". ' +
      (hasCertificate
        ? 'The site is currently serving a certificate, so this is not blocking today — it will ' +
          'block the next renewal, most likely at 3 a.m. on the day the current one expires.'
        : 'Any attempt to obtain a certificate for this domain will be refused.'),
    evidence: { name: caa.name, records: caa.records, host },
    remediation:
      `Add an issue property naming the CA you use to the CAA set at ${caa.name}, e.g. ` +
      'issue "letsencrypt.org", keeping the existing iodef address.',
    fixPrompt:
      `The CAA record set at "${caa.name}" is ${JSON.stringify(caa.records)}. It authorizes no ` +
      'Certificate Authority, so certificate issuance and renewal for this domain will fail.\n\n' +
      'This is a DNS change, not a code change. Determine which CA issues the certificate in use ' +
      '(check the current certificate\'s issuer, and remember a CDN or load balancer may obtain its ' +
      `own), then add a CAA issue record for it at "${caa.name}", for example:\n\n` +
      '  CAA 0 issue "letsencrypt.org"\n' +
      '  CAA 0 issuewild "letsencrypt.org"\n\n' +
      'Keep the existing iodef record. If the intent really was to forbid all issuance, leave it ' +
      'as it is and make sure nobody is relying on automated renewal.',
  }
}

/**
 * Values are grouped by tag. Anything the context could not render as a
 * `tag "value"` pair is ignored rather than guessed at — an unparseable record
 * must not be read as an authorization that isn't there, nor as one that is.
 */
function parseProperties(records: readonly string[]): CaaProperties {
  const properties: CaaProperties = { issue: [], issuewild: [], iodef: [] }

  for (const record of records) {
    const match = PROPERTY.exec(record.trim())
    if (!match) continue
    const [, tag, rawValue] = match
    // Parameters follow the issuer name after a ";" — `issue "ca.example; account=1"`.
    // The issuer itself is what authorizes; a bare ";" is the empty issuer.
    const issuer = (rawValue ?? '').split(';')[0]?.trim() ?? ''
    if (tag === 'iodef') properties.iodef.push(issuer)
    else if (tag === 'issue') properties.issue.push(issuer)
    else if (tag === 'issuewild') properties.issuewild.push(issuer)
  }

  return properties
}
