/**
 * /robots.txt — the file that can switch off a site's entire search presence
 * with two lines, and routinely does when a staging config ships to production.
 *
 * The parsed rules come from the context (see context/robots.ts), so this check
 * asks questions of them rather than re-parsing text: does Googlebot get to
 * fetch the root, and does everyone else?
 *
 * Googlebot and the wildcard group are reported as ONE finding, not two — when
 * "User-agent: * / Disallow: /" blocks the site, Googlebot is blocked by that
 * same rule, and charging the score twice for one line would be wrong.
 */

import type { Check, Finding } from '../types.ts'

const ID = 'seo.robots-txt'

export const robotsTxtCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'robots.txt',

  run(ctx) {
    if (!ctx.robots) {
      return [
        {
          checkId: ID,
          category: 'seo',
          severity: 'low',
          title: 'No robots.txt',
          description:
            '/robots.txt is missing or did not answer with 200. Crawling still works — everything is ' +
            'allowed by default — but there is nowhere to point crawlers at the sitemap or to keep bots ' +
            'out of expensive paths, and some crawlers treat a server error here as "crawl nothing".',
          remediation: 'Serve a /robots.txt with a permissive default and a Sitemap: line.',
          fixPrompt:
            'Add a /robots.txt to this site containing:\n\nUser-agent: *\nAllow: /\nSitemap: ' +
            '<absolute URL of the sitemap>\n\nServe it from the framework\'s route (Next.js app/robots.ts) ' +
            'or the static public directory, and confirm it returns HTTP 200 with a text/plain type.',
        } satisfies Finding,
      ]
    }

    const { raw, allows } = ctx.robots
    const findings: Finding[] = []

    // A robots.txt that is actually an HTML error page parses to zero rules, so
    // it looks permissive while telling us nothing about the real intent.
    if (/^\s*<(!doctype|html)\b/i.test(raw)) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: 'robots.txt returns HTML, not plain text',
        description:
          '/robots.txt answered 200 with an HTML document — almost always a catch-all route or SPA ' +
          'fallback serving the app shell. No directive in it is parseable, so the Sitemap line and any ' +
          'crawl rules the team believes are live are not.',
        evidence: { snippet: raw.slice(0, 200) },
        remediation: 'Exclude /robots.txt from the catch-all route and serve it as text/plain.',
        fixPrompt:
          'This site serves HTML at /robots.txt (a catch-all route is intercepting it). Serve a real ' +
          'text/plain robots.txt instead and exclude that path from the SPA/catch-all rewrite.',
      })
      return findings
    }

    const googlebotBlocked = !allows('Googlebot', '/')
    const everyoneBlocked = !allows('*', '/')

    if (googlebotBlocked) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'critical',
        title: 'robots.txt blocks Googlebot from the whole site',
        description:
          'robots.txt disallows Googlebot from "/", so Google will not crawl any page. This is the ' +
          'other half of the "site disappeared from Google" pattern, and it is usually a staging ' +
          'robots.txt that shipped to production.',
        evidence: { robotsTxt: raw.slice(0, 500) },
        remediation: 'Remove the site-wide Disallow: / so crawlers can reach the site.',
        fixPrompt:
          'This site\'s /robots.txt disallows crawling of "/" for Googlebot. Unless the site is meant to ' +
          'be private, replace the blocking rule with:\n\nUser-agent: *\nAllow: /\n\nCheck whether the ' +
          'file is generated from an environment flag — the usual cause is a staging value in production. ' +
          'After fixing, resubmit the sitemap in Search Console; re-indexing takes days.',
      })
    } else if (everyoneBlocked) {
      findings.push({
        checkId: ID,
        category: 'seo',
        severity: 'medium',
        title: 'robots.txt blocks all crawlers except Googlebot',
        description:
          'The wildcard group disallows "/", and only Googlebot has an exception. Bing, DuckDuckGo, ' +
          'social-preview fetchers and AI answer engines are all shut out, so the site exists in exactly ' +
          'one index.',
        evidence: { robotsTxt: raw.slice(0, 500) },
        remediation: 'Allow the wildcard group unless every non-Google crawler is deliberately excluded.',
        fixPrompt:
          'This site\'s /robots.txt blocks "/" for User-agent: * while allowing Googlebot. Unless that is ' +
          'deliberate, allow the wildcard group so other search engines, social preview bots and AI ' +
          'crawlers can fetch the site.',
      })
    }

    return findings
  },
}
