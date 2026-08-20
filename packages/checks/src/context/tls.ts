/**
 * TLS inspection: one extra handshake against the final host to capture the
 * peer certificate and negotiated protocol. Separate from the page fetch
 * because undici pools/reuses sockets and does not expose the certificate.
 *
 * `rejectUnauthorized: false` is deliberate — an expired or self-signed
 * certificate must not abort inspection; it IS the finding (cert-expiry check).
 * The socket goes through `guardedLookup`, so the SSRF guarantee holds here too.
 */

import { connect } from 'node:tls'
import type { CheckContext } from '../types.ts'
import { guardedLookup } from './ssrf-guard.ts'

const HANDSHAKE_TIMEOUT_MS = 5_000

export function getTlsInfo(hostname: string, port: number): Promise<CheckContext['tls']> {
  return new Promise((resolve) => {
    let socket: ReturnType<typeof connect>
    try {
      socket = connect({
        host: hostname,
        port,
        servername: hostname, // SNI — required for any multi-tenant host
        lookup: guardedLookup,
        rejectUnauthorized: false,
        // Allow legacy protocol negotiation ON PURPOSE: Node's default floor is
        // TLS 1.2, which would make the handshake to an outdated server fail and
        // the protocol-version check silently skip — the exact server it exists
        // to flag. OpenSSL 3 additionally gates TLS <1.2 behind SECLEVEL=0.
        // This client only reads public metadata; nothing sensitive rides on it.
        minVersion: 'TLSv1',
        ciphers: 'DEFAULT:@SECLEVEL=0',
      })
    } catch {
      resolve(null) // e.g. an OpenSSL build that rejects the cipher string
      return
    }

    // Resolve exactly once, then tear the socket down. null = "could not
    // inspect", which checks treat as skip, never as a finding.
    const finish = (result: CheckContext['tls']) => {
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(HANDSHAKE_TIMEOUT_MS, () => finish(null))
    socket.on('error', () => finish(null))

    socket.on('secureConnect', () => {
      const cert = socket.getPeerCertificate()
      if (!cert || !cert.valid_to) {
        finish(null)
        return
      }
      // Node types issuer fields as string | string[] (multi-valued RDNs); take the first.
      const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
      finish({
        validTo: new Date(cert.valid_to),
        protocol: socket.getProtocol() ?? 'unknown',
        issuer: first(cert.issuer?.O) ?? first(cert.issuer?.CN) ?? 'unknown',
      })
    })
  })
}
