/**
 * Negotiated TLS protocol version. We report what OUR handshake negotiated:
 * modern clients pick the best mutually supported version, so landing on
 * TLS 1.1 or older means the server offers nothing newer — deprecated by every
 * browser (and by RFC 8996) and vulnerable to downgrade/BEAST-era attacks.
 * TLS 1.2 and 1.3 pass; the server may additionally allow old versions for
 * legacy clients, but detecting that needs per-version probes (Phase 2+).
 */

import type { Check, Finding } from '../../types.ts'

const ID = 'security.tls.protocol-version'

export const tlsProtocolVersionCheck: Check = {
  id: ID,
  category: 'security',
  title: 'TLS protocol version',

  run(ctx) {
    if (!ctx.tls) return []

    const { protocol } = ctx.tls
    const outdated = protocol === 'TLSv1' || protocol === 'TLSv1.1' || protocol.startsWith('SSLv')
    if (!outdated) return []

    return [
      {
        checkId: ID,
        category: 'security',
        severity: protocol.startsWith('SSLv') ? 'critical' : 'high',
        title: `Server negotiated outdated ${protocol}`,
        description:
          `Our modern TLS client could only negotiate ${protocol}, so the server supports nothing newer. ` +
          'All versions below TLS 1.2 are formally deprecated (RFC 8996), rejected by current browsers, ' +
          'and carry known cryptographic weaknesses.',
        evidence: { protocol, issuer: ctx.tls.issuer },
        remediation: 'Enable TLS 1.2 and 1.3 on the server or load balancer and disable everything older.',
        fixPrompt:
          `This server negotiates ${protocol}. Update the TLS configuration (web server, load balancer or ` +
          'CDN) to enable TLS 1.3 and TLS 1.2 only — e.g. nginx: `ssl_protocols TLSv1.2 TLSv1.3;` — and ' +
          'disable SSLv3/TLS 1.0/TLS 1.1. Re-test the handshake afterwards.',
      } satisfies Finding,
    ]
  },
}
