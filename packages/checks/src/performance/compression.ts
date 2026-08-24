/**
 * Whether the server compresses what it sends.
 *
 * Text compresses by 70–80%, so an uncompressed HTML response is several times
 * larger than it needs to be on every visit — worst on the mobile connections
 * where it matters most. It is also usually one line of server config that
 * nobody turned on.
 *
 * Observable only because the scanner asks for it: a server sets
 * Content-Encoding when a request advertises Accept-Encoding, and safeFetch now
 * does. Small responses are exempt, because below roughly two kilobytes the
 * compression framing costs more than it saves and servers correctly skip it.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'performance.compression'

/** Under this, compressing is not worth the framing bytes, and servers know it. */
const WORTH_COMPRESSING_BYTES = 2048

export const compressionCheck: Check = {
  id: ID,
  category: 'performance',

  title: 'Response compression',

  run(ctx) {
    const contentType = ctx.headers.get('content-type') ?? ''
    if (!/\b(text\/|application\/(json|javascript|xml|xhtml))/i.test(contentType)) return []

    const encoding = ctx.headers.get('content-encoding')?.trim().toLowerCase()
    if (encoding && encoding !== 'identity') return []

    const bytes = Buffer.byteLength(ctx.html, 'utf8')
    if (bytes < WORTH_COMPRESSING_BYTES) return []

    const estimated = Math.round(bytes * 0.25)

    return [
      {
        checkId: ID,
        category: 'performance',
        severity: 'low',
        title: 'HTML is served uncompressed',
        description:
          `The scan asked for gzip, deflate and brotli, and the server returned ${bytes.toLocaleString()} ` +
          `bytes of HTML with no Content-Encoding. Compressed it would be roughly ` +
          `${estimated.toLocaleString()} bytes — the difference is paid on every visit, by every ` +
          'visitor, and hurts most on the slow connections where it is least affordable.',
        evidence: { bytes, contentEncoding: encoding ?? null, contentType },
        remediation: 'Enable gzip or brotli for text responses at the web server or CDN.',
        fixPrompt:
          'This site serves HTML uncompressed. Turn on text compression at whatever terminates TLS: ' +
          'nginx `gzip on;` plus `gzip_types` for text/html, text/css and application/javascript (or ' +
          'the brotli module); Apache `mod_deflate`; on a CDN it is usually a single toggle. Verify ' +
          'with `curl -sI -H "Accept-Encoding: gzip, br" <url> | grep -i content-encoding` — the ' +
          'header only appears when the request asked for it, so a plain curl will look uncompressed ' +
          'either way.',
      } satisfies Finding,
    ]
  },
}
