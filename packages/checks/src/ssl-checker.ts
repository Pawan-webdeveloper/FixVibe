/*
 *
 * Pure SSL certificate probe. No DB, no Inngest — just a hostname in,
 * structured result out. Easy to unit-test, easy to call from anywhere.
 *
 * Uses Node's built-in `tls` module — no extra dependency.
 *
 * Why TLS directly instead of safeFetch?
 *   safeFetch measures HTTP response. We need the TLS handshake itself —
 *   the cert's notAfter, the issuer, whether the chain validates. An HTTP
 *   200 says nothing about whether the cert expires in 3 days.
 */

import * as tls from 'node:tls'

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export interface SslCheckResult {
  /** False if the connection failed or the cert is already expired. */
  ok: boolean
  /** Days until expiry. Negative means already expired. */
  daysUntilExpiry: number | null
  /** ISO-8601 expiry date from the cert. */
  expiresAt: string | null
  /** CN or SAN the cert was issued for. */
  subject: string | null
  /** Error message if the connection failed. */
  detail: string | null
}


/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

const CONNECT_TIMEOUT_MS = 10_000



/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Connects to `hostname:443`, reads the TLS certificate, and returns
 * structured expiry information.
 *
 * Does NOT throw — all errors are returned as `{ ok: false, detail }`.
 */


export async function checkSsl(hostname: string): Promise<SslCheckResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.destroy()
      resolve({ ok: false, daysUntilExpiry: null, expiresAt: null, subject: null, detail: 'Connection timed out' })
    }, CONNECT_TIMEOUT_MS)
 
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, rejectUnauthorized: true },
      () => {
        clearTimeout(timeout)
 
        const cert = socket.getPeerCertificate()
        socket.destroy()
 
        if (!cert || !cert.valid_to) {
          return resolve({ ok: false, daysUntilExpiry: null, expiresAt: null, subject: null, detail: 'No certificate returned' })
        }
 
        const expiresAt = new Date(cert.valid_to)
        const daysUntilExpiry = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000)
        const subject = (typeof cert.subject?.CN === 'string' ? cert.subject.CN : null) ?? null /* monitor error — cert.subject.CN can be string | string[] | null, narrowed to string | null */
 
        resolve({
          ok: daysUntilExpiry > 0,
          daysUntilExpiry,
          expiresAt: expiresAt.toISOString(),
          subject,
          detail: daysUntilExpiry <= 0 ? `Certificate expired ${Math.abs(daysUntilExpiry)} days ago` : null,
        })
      },
    )

    socket.on('error', (err) => {
      clearTimeout(timeout)
      socket.destroy()
      resolve({ ok: false, daysUntilExpiry: null, expiresAt: null, subject: null, detail: err.message })
    })
  })
}