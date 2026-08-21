/**
 * XML sitemap — how a crawler discovers pages that are not reachable by
 * following links from the home page in a few hops.
 *
 * The one probe this check spends goes to the sitemap the SITE declares in
 * robots.txt, falling back to /sitemap.xml only when nothing is declared.
 * Probing a fixed /sitemap.xml and then reporting on a differently-named
 * declared sitemap would describe a URL we never fetched — a fabricated
 * finding, and the easiest way to lose a user's trust.
 *
 * `probe()` resolves to null on network failure or when the per-scan probe cap
 * is spent. Null means "unknown", never "missing": a check may only report what
 * it observed.
 */

import type { Check, CheckContext, Finding } from '../types.ts'

const ID = 'seo.sitemap'

const DEFAULT_PATH = '/sitemap.xml'

export const sitemapCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'XML sitemap',

  async run(ctx) {
    const declared = ctx.robots?.sitemaps ?? []
    const sameOrigin = declared.filter((href) => isSameOrigin(href, ctx.finalUrl))

    // Declared somewhere we cannot reach (another host): nothing observable.
    if (declared.length > 0 && sameOrigin.length === 0) return []

    const path = sameOrigin[0] ? pathOf(sameOrigin[0]) : DEFAULT_PATH
    const response = await ctx.probe(path)

    if (declared.length === 0) return undeclared(ctx, path, response)
    return declaredButBroken(ctx, path, response)
  },
}

/** Nothing in robots.txt — did the conventional location answer? */
function undeclared(ctx: CheckContext, path: string, response: ProbeResult): Finding[] {
  const url = new URL(path, ctx.finalUrl).href

  if (!response || response.status !== 200) {
    return [
      {
        checkId: ID,
        category: 'seo',
        severity: 'low',
        title: 'No XML sitemap found',
        description:
          `robots.txt declares no sitemap and ${url} did not return one` +
          `${response ? ` (HTTP ${response.status})` : ' (no response)'}. Crawlers then discover pages ` +
          'only by following links, so anything deep in the site, newly published, or linked from just ' +
          'one place waits much longer to be indexed.',
        evidence: { probed: url, status: response?.status ?? null },
        remediation: 'Publish an XML sitemap and reference it from robots.txt with a Sitemap: line.',
        fixPrompt:
          'This site has no XML sitemap. Generate one (Next.js: app/sitemap.ts; otherwise a build-time ' +
          'generator writing /sitemap.xml), serve it at a stable URL, and add a "Sitemap: <absolute URL>" ' +
          'line to robots.txt. Then submit it in Google Search Console.',
      },
    ]
  }

  const findings: Finding[] = [
    {
      checkId: ID,
      category: 'seo',
      severity: 'info',
      title: 'Sitemap is not declared in robots.txt',
      description:
        `${url} exists, but robots.txt does not point to it. Crawlers that have not guessed the ` +
        'conventional path — and every non-Google crawler that only reads robots.txt — never find it.',
      evidence: { sitemap: url },
      remediation: `Add "Sitemap: ${url}" to robots.txt.`,
      fixPrompt: `Add the line "Sitemap: ${url}" to this site's robots.txt.`,
    },
  ]

  findings.push(...notXml(url, response))
  return findings
}

/** robots.txt points at a same-origin sitemap — does that exact URL work? */
function declaredButBroken(ctx: CheckContext, path: string, response: ProbeResult): Finding[] {
  const url = new URL(path, ctx.finalUrl).href

  if (!response) return [] // unreachable during this scan — not evidence of anything

  if (response.status !== 200) {
    return [
      {
        checkId: ID,
        category: 'seo',
        severity: 'medium',
        title: `Declared sitemap returns HTTP ${response.status}`,
        description:
          `robots.txt points crawlers at ${url}, but it answers ${response.status}. Search Console ` +
          'reports this as a sitemap error and the URLs it should have listed are discovered only by ' +
          'link-following, if at all.',
        evidence: { sitemap: url, status: response.status },
        remediation: 'Deploy the sitemap at the declared URL, or point robots.txt at the real one.',
        fixPrompt:
          `This site's robots.txt declares the sitemap ${url}, which returns HTTP ${response.status}. ` +
          'Either publish the sitemap at that exact URL or update the Sitemap: line to the URL that ' +
          'actually serves it.',
      },
    ]
  }

  return notXml(url, response)
}

/**
 * Only the unambiguous failure is reported: a 200 that is an HTML page, i.e. a
 * catch-all route swallowing the path. Anything else that merely lacks a
 * <urlset> — a gzipped sitemap, a truncated body — stays silent rather than
 * guessing.
 */
function notXml(url: string, response: NonNullable<ProbeResult>): Finding[] {
  const body = response.body
  const looksLikeSitemap = body.includes('<urlset') || body.includes('<sitemapindex')
  if (looksLikeSitemap || !/^\s*<(!doctype|html)\b/i.test(body)) return []

  return [
    {
      checkId: ID,
      category: 'seo',
      severity: 'low',
      title: 'Sitemap URL serves an HTML page',
      description:
        `${url} returns 200 with an HTML document rather than a sitemap. A catch-all route is ` +
        'intercepting the path, so crawlers fetch the app shell and parse no URLs — while every ' +
        'monitoring tool that only checks the status code reports the sitemap as healthy.',
      evidence: { sitemap: url, snippet: body.slice(0, 200) },
      remediation: 'Exclude the sitemap path from the catch-all route and serve it as application/xml.',
      fixPrompt:
        `${url} responds with HTML instead of XML because a catch-all/SPA route is handling it. Serve ` +
        'the generated sitemap at that path with an application/xml content type and exclude the path ' +
        'from the rewrite rules.',
    },
  ]
}

type ProbeResult = Awaited<ReturnType<CheckContext['probe']>>

function isSameOrigin(href: string, base: URL): boolean {
  try {
    return new URL(href).origin === base.origin
  } catch {
    return false
  }
}

function pathOf(href: string): string {
  const url = new URL(href)
  return `${url.pathname}${url.search}`
}
