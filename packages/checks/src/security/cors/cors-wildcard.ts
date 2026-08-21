/**
 * CORS — reads the Access-Control-* headers of the page response, which was a
 * plain GET carrying NO Origin header. That bounds what can honestly be said:
 * a server that REFLECTS whatever Origin it is handed — the most common serious
 * CORS bug — answers us exactly like a server with no CORS policy at all, and
 * probe() cannot send custom headers. So this check never tests reflection and
 * never implies it did.
 *
 * It also deliberately refuses to call `Access-Control-Allow-Origin: *` on a
 * public HTML page a vulnerability. The document is readable by anyone with or
 * without CORS, and `*` is precisely the value browsers will not pair with
 * credentials. What is reportable from one uncredentialed response is a policy
 * that contradicts itself, or one that allowlists an origin anybody can forge.
 */

import type { Check, Finding } from '../../types.ts'

const ID = 'security.cors.wildcard'

export const corsWildcardCheck: Check = {
  id: ID,
  category: 'security',
  title: 'CORS policy',

  run(ctx) {
    const acao = ctx.headers.get('access-control-allow-origin')
    if (acao === null) return []

    const origin = acao.trim()
    const acacHeader = ctx.headers.get('access-control-allow-credentials')
    // Fetch compares this value byte-for-byte against "true"; "True" or "1" leave
    // credentials off, so treating them as enabled would invent a policy.
    const credentials = (acacHeader ?? '').trim() === 'true'

    if (origin === 'null' && credentials) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'high',
          title: 'CORS grants credentialed access to the null origin',
          description:
            'Allow-Origin: null together with Allow-Credentials: true tells the browser that a document ' +
            'whose origin serialises to "null" — any sandboxed iframe, data: URL or local file — may read ' +
            'this response with the user\'s credentials attached. Any site can open such a document, so ' +
            '"null" allowlists everyone rather than restricting anyone.',
          evidence: {
            accessControlAllowOrigin: acao,
            accessControlAllowCredentials: acacHeader,
          },
          remediation:
            'Remove null from the allowed origins: echo only origins on an explicit allowlist, and refuse ' +
            'the request when the Origin header is null or absent.',
          fixPrompt:
            'This site responds with "Access-Control-Allow-Origin: null" and ' +
            '"Access-Control-Allow-Credentials: true". Find where CORS is configured (server config, ' +
            'framework CORS middleware, or edge/CDN rules) and replace the null origin with an explicit ' +
            'allowlist of trusted origins; echo the request Origin back only when it is in that list, and ' +
            'send no Access-Control-Allow-Origin at all otherwise. Never allowlist "null".',
        } satisfies Finding,
      ]
    }

    if (origin === '*' && credentials) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'medium',
          title: 'CORS sends Allow-Origin: * with Allow-Credentials: true',
          description:
            'Browsers reject this pairing outright — a credentialed cross-origin request to this response ' +
            'fails no matter what. The wildcard itself is harmless on a public page; the finding is that ' +
            'the CORS policy in the config is not the policy in force, and the same config is usually ' +
            'applied to API routes where the difference matters.',
          evidence: {
            accessControlAllowOrigin: acao,
            accessControlAllowCredentials: acacHeader,
          },
          remediation:
            'Pick one: drop Allow-Credentials if the data is public, or replace the wildcard with a ' +
            'specific allowlisted origin if credentialed requests are genuinely needed.',
          fixPrompt:
            'This site sends "Access-Control-Allow-Origin: *" together with ' +
            '"Access-Control-Allow-Credentials: true", a combination browsers refuse. Find the CORS ' +
            'configuration and decide which behaviour is intended. If cross-origin callers never need ' +
            'cookies or auth headers, remove Access-Control-Allow-Credentials. If they do, drop the ' +
            'wildcard and echo the request Origin only when it matches an explicit allowlist. Apply the ' +
            'same decision to the API routes sharing this configuration.',
        } satisfies Finding,
      ]
    }

    if (origin === 'null') {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'low',
          title: 'CORS allows the null origin',
          description:
            'Allow-Origin is set to "null". Sandboxed iframes, data: URLs and local files all present that ' +
            'origin, and any site can create one, so the value restricts nothing. This response carries no ' +
            'Allow-Credentials, so what is exposed here is content that is already public — but "null" is ' +
            'almost always a leftover from local-file or sandbox testing rather than an intended policy.',
          evidence: { accessControlAllowOrigin: acao },
          remediation:
            'Replace the null origin with an explicit allowlist of the origins that actually call this site.',
          fixPrompt:
            'This site responds with "Access-Control-Allow-Origin: null". Find the CORS configuration and ' +
            'replace it with an explicit allowlist: echo the request Origin only when it is on the list, ' +
            'and omit the header otherwise. Check whether the null value was added for local file:// or ' +
            'sandboxed-iframe testing and can simply be deleted.',
        } satisfies Finding,
      ]
    }

    // Exactly one origin, "*" or "null" is the whole grammar. A space or comma
    // means either a list or a repeated header — Headers.get() joins duplicates
    // with ", ", so the two are indistinguishable here and the wording says so.
    if (/[\s,]/.test(origin)) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'low',
          title: 'Access-Control-Allow-Origin carries more than one value',
          description:
            'The header may hold exactly one origin, or "*", or "null". This response carries several — ' +
            'either a comma-separated list or the header set twice. Browsers match the caller\'s origin ' +
            'against the entire string, so nothing ever matches and every cross-origin read fails, ' +
            'including the ones the allowlist was written to permit.',
          evidence: { accessControlAllowOrigin: acao },
          remediation:
            'Send a single Access-Control-Allow-Origin per response, echoing the one allowlisted origin ' +
            'that made the request.',
          fixPrompt:
            `This site responds with "Access-Control-Allow-Origin: ${acao}", which is not a valid value — ` +
            'the header takes one origin only. Rewrite the CORS configuration to compare the incoming ' +
            'Origin header against the allowlist and echo back just that one origin (omitting the header ' +
            'when there is no match). Also confirm no second layer — proxy, CDN or middleware — is ' +
            'appending its own Access-Control-Allow-Origin.',
        } satisfies Finding,
      ]
    }

    if (origin === '*') {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'info',
          title: 'Wildcard CORS policy on this page',
          description:
            'This page is served with Access-Control-Allow-Origin: *. On public HTML that is not a ' +
            'weakness — the content is fetchable without CORS anyway, and "*" is the one value browsers ' +
            'refuse to combine with credentials. It is worth confirming the same header is not applied to ' +
            'endpoints whose access depends on where the request comes from, such as an intranet or ' +
            'localhost service, since a wildcard lets any page in a user\'s browser read those responses.',
          evidence: { accessControlAllowOrigin: acao },
          remediation:
            'No change is needed for public pages; review any API or internal endpoint that inherits the ' +
            'same wildcard.',
          fixPrompt:
            'This site sends "Access-Control-Allow-Origin: *" on its HTML pages. Locate where that header ' +
            'is set and check its scope: if it is applied globally, narrow it so that API routes and any ' +
            'endpoint relying on network position for access do not inherit the wildcard. Leaving it on ' +
            'genuinely public, unauthenticated responses is fine.',
        } satisfies Finding,
      ]
    }

    // A single concrete origin — with or without Allow-Credentials — is what a
    // correct allowlist looks like from the outside. Nothing to report.
    return []
  },
}
