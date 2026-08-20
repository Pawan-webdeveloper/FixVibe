/**
 * HTTPS enforcement, judged from what the scan actually observed:
 *
 *   1. Final page on http://          → critical (everything is interceptable)
 *   2. User gave http://, we landed
 *      on https://                    → upgrade works, pass
 *   3. User gave https:// — the main fetch never saw port 80, so buildContext
 *      captured `httpProbe` (first raw response of http://host/):
 *        null / absent → port 80 closed or unknown: pass (nothing to strip)
 *        3xx → https   → pass
 *        3xx → http    → low  (first hop stays strippable before the upgrade)
 *        2xx           → high (full site readable over plain HTTP, no redirect)
 *        4xx/5xx       → pass (http refused — fine)
 */

import type { Check, Finding } from '../../types.ts'

const ID = 'security.tls.https-redirect'

export const httpsRedirectCheck: Check = {
  id: ID,
  category: 'security',
  title: 'HTTP → HTTPS redirect',

  run(ctx) {
    if (ctx.finalUrl.protocol === 'http:') {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'critical',
          title: 'Site is served over plain HTTP',
          description:
            'The page loads over unencrypted HTTP: anyone on the network path can read and modify ' +
            'everything — pages, forms, cookies, injected scripts included.',
          evidence: { finalUrl: ctx.finalUrl.href, redirectChain: ctx.redirectChain },
          remediation: 'Serve the site over HTTPS and 301-redirect every http:// request to https://.',
          fixPrompt:
            'This site serves pages over plain HTTP. Enable HTTPS (most hosts issue certificates ' +
            'automatically; otherwise use Let’s Encrypt), then add a permanent 301 redirect from ' +
            'http:// to https:// for every path, and update absolute internal URLs to https.',
        } satisfies Finding,
      ]
    }

    // Landed on https after starting from http — the redirect we wanted exists.
    // Still inspect the path it took: chain[0] is the user's own http entry
    // (expected), but any LATER http hop means the redirect lingers on plain
    // HTTP before upgrading — same stripping window the probe branch flags.
    if (ctx.url.protocol === 'http:') {
      const insecureHop = ctx.redirectChain.slice(1).find((hop) => hop.startsWith('http:'))
      if (!insecureHop) return []
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'low',
          title: 'HTTP redirect does not go straight to HTTPS',
          description:
            `The upgrade to HTTPS takes a detour through ${insecureHop} — every extra plain-HTTP hop ` +
            'is interceptable before the connection finally becomes secure.',
          evidence: { redirectChain: ctx.redirectChain, finalUrl: ctx.finalUrl.href },
          remediation: 'Redirect http:// requests directly to the final https:// URL in a single hop.',
          fixPrompt:
            'This site upgrades HTTP to HTTPS through an intermediate plain-HTTP redirect ' +
            `(${ctx.redirectChain.join(' → ')} → ${ctx.finalUrl.href}). Change the server/CDN redirect ` +
            'rules so the first http:// response 301s directly to the final https:// URL.',
        } satisfies Finding,
      ]
    }

    const probe = ctx.httpProbe
    if (!probe) return [] // port 80 closed/unreachable, or probe not captured — nothing served to strip

    if (probe.status >= 300 && probe.status < 400) {
      if (probe.location?.startsWith('https://')) return []
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'low',
          title: 'HTTP redirect does not go straight to HTTPS',
          description:
            'Port 80 answers with a redirect that stays on http://, so the first hop remains ' +
            'interceptable before any upgrade happens. Every http response is a stripping window.',
          evidence: { status: probe.status, location: probe.location },
          remediation: 'Redirect http:// requests directly to the https:// equivalent in a single hop.',
          fixPrompt:
            'The http:// version of this site redirects to another http:// URL. Change the server/CDN ' +
            'rule so every http request 301-redirects directly to its https:// equivalent in one hop.',
        } satisfies Finding,
      ]
    }

    if (probe.status >= 200 && probe.status < 300) {
      return [
        {
          checkId: ID,
          category: 'security',
          severity: 'high',
          title: 'Site is also reachable over plain HTTP',
          description:
            'http:// serves content (HTTP ' + probe.status + ') instead of redirecting. Users and links ' +
            'that start on http never reach the encrypted site, and stay fully interceptable.',
          evidence: { status: probe.status },
          remediation: '301-redirect all http:// traffic to https:// and add HSTS once that works.',
          fixPrompt:
            'This site responds with content on http:// instead of redirecting. Add a permanent ' +
            '301 redirect from http to https for all paths at the web server / load balancer / CDN ' +
            'level, then send a Strict-Transport-Security header on the https responses.',
        } satisfies Finding,
      ]
    }

    return [] // 4xx/5xx on port 80 — http is effectively refused
  },
}
