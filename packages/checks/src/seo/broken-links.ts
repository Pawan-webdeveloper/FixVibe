/**
 * Links on the home page that lead nowhere.
 *
 * A broken internal link costs three things at once: a visitor hits a dead
 * end, a crawler spends budget on a URL that will never rank, and whatever
 * authority the linking page was passing evaporates. It is also one of the few
 * SEO defects that is unambiguous — either the server said 404 or it did not.
 *
 * ## What this refuses to call broken
 *
 * Only **404 and 410** ("gone", and the site said so deliberately) and **5xx**
 * count. Everything else that looks like a failure has an innocent reading:
 *
 *   401 / 403 — the page needs a login, or a WAF does not like our user-agent.
 *               A members' area is not a broken link.
 *   429       — we asked too quickly. That is our fault, not the site's.
 *   405       — the method was refused, which says nothing about the resource.
 *   3xx       — a redirect resolves; the crawl already followed it and what
 *               matters is where it landed.
 *
 * A URL the crawl could not reach at all is absent from `linkStatus` and is
 * therefore invisible here, which is correct: a timeout on our side must never
 * be published as a defect on someone else's site.
 *
 * The counts are always qualified by how much of the page was actually
 * checked. "No broken links" from a scan that looked at 25 of 300 links is a
 * claim we have not earned, so the evidence carries both numbers and the
 * finding text does too.
 */

import type { Check, CheckContext, CrawlSummary, Finding } from '../types.ts'

const ID = 'seo.broken-links'

/** The site told us the resource is not there. Nothing else is this definite. */
const GONE = new Set([404, 410])

/** Shown in the report; the rest are counted. Enough to start fixing, not a wall of text. */
const MAX_LISTED = 12

export const brokenLinksCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'Broken internal links',

  run(ctx) {
    // No crawl means a fast scan: we never looked, so we have nothing to say.
    const crawl = ctx.crawl
    if (!crawl) return []

    const entries = Object.entries(crawl.linkStatus)
    const gone = entries.filter(([, status]) => GONE.has(status))
    const failing = entries.filter(([, status]) => status >= 500 && status <= 599)

    const findings: Finding[] = []
    if (gone.length > 0) findings.push(goneFinding(ctx, crawl, gone))
    if (failing.length > 0) findings.push(serverErrorFinding(ctx, crawl, failing))
    return findings
  },
}

function goneFinding(ctx: CheckContext, crawl: CrawlSummary, gone: Array<[string, number]>): Finding {
  const paths = gone.map(([url, status]) => `${pathOf(url, ctx)} → ${status}`)

  return {
    checkId: ID,
    category: 'seo',
    // One dead link in a navigation is a real defect but not an emergency;
    // several is a page nobody has opened in a while.
    severity: gone.length >= 5 ? 'medium' : 'low',
    title: `${gone.length} broken link${gone.length === 1 ? '' : 's'} on this page`,
    description:
      `Following the links on this page, ${gone.length} returned 404 or 410 — the server said the ` +
      'resource is not there. Visitors who click them hit a dead end, and search engines spend ' +
      'crawl budget on URLs that will never rank while the linking page passes its authority into ' +
      `nothing. ${coverageSentence(crawl)}`,
    evidence: { broken: paths.slice(0, MAX_LISTED), ...coverage(crawl, gone.length) },
    remediation:
      'Point each link at the page that replaced it, or remove the link. Where the old URL is worth ' +
      'keeping, add a 301 redirect to its replacement rather than leaving a 404.',
    fixPrompt:
      `These links on ${ctx.finalUrl.href} return 404 or 410:\n\n` +
      paths
        .slice(0, MAX_LISTED)
        .map((line) => `  ${line}`)
        .join('\n') +
      (gone.length > MAX_LISTED ? `\n  …and ${gone.length - MAX_LISTED} more` : '') +
      '\n\nFor each one, find where it is written in this repository — it may be a hard-coded href, ' +
      'a nav or footer config, a CMS field, or markdown content. Then decide per link:\n\n' +
      '  - The target moved: update the href to the new path, AND add a 301 redirect from the old ' +
      'path so any external links and bookmarks still work.\n' +
      '  - The target is gone for good: remove the link.\n' +
      '  - The target should exist: create the page.\n\n' +
      'Do not "fix" these by adding a catch-all redirect to the home page — that turns a clear 404 ' +
      'into a soft 404, which search engines treat worse. Check the routing config for a redirect ' +
      'that is already meant to cover these and is not matching.',
  }
}

function serverErrorFinding(ctx: CheckContext, crawl: CrawlSummary, failing: Array<[string, number]>): Finding {
  const paths = failing.map(([url, status]) => `${pathOf(url, ctx)} → ${status}`)

  return {
    checkId: ID,
    category: 'seo',
    severity: 'medium',
    title: `${failing.length} link${failing.length === 1 ? '' : 's'} on this page returned a server error`,
    description:
      `${failing.length} of the links followed from this page answered with a 5xx status. Unlike a ` +
      '404 this is not a routing mistake — something on the server failed while producing the page. ' +
      'It may be intermittent, so confirm it by loading the URLs directly; if it reproduces, these ' +
      `pages are down for visitors and for search engines alike. ${coverageSentence(crawl)}`,
    evidence: { failing: paths.slice(0, MAX_LISTED), ...coverage(crawl, failing.length) },
    remediation:
      'Open each URL and read the server logs for that request. A 5xx is an application error, not a ' +
      'link to be rewritten.',
    fixPrompt:
      `These links on ${ctx.finalUrl.href} returned a 5xx server error:\n\n` +
      paths
        .slice(0, MAX_LISTED)
        .map((line) => `  ${line}`)
        .join('\n') +
      '\n\nStart by reproducing them — request each path and capture the response and the server-side ' +
      'stack trace. This is an application bug on those routes, not a broken href, so do NOT change ' +
      'the links. Find the route handler for each path in this repository and work out what throws: ' +
      'common causes are an unhandled null from a data fetch, a missing environment variable in this ' +
      'deployment, or a database query that fails only for certain parameters. Add a test that ' +
      'reproduces the failing request before fixing it.',
  }
}

/** Honest denominators. A count of broken links means nothing without them. */
function coverage(crawl: CrawlSummary, matched: number) {
  return {
    linksChecked: Object.keys(crawl.linkStatus).length,
    linksFound: crawl.linksFound,
    ...(crawl.linksSkipped > 0 ? { linksNotChecked: crawl.linksSkipped } : {}),
    ...(crawl.linksDisallowed > 0 ? { linksExcludedByRobotsTxt: crawl.linksDisallowed } : {}),
    ...(matched > MAX_LISTED ? { notListed: matched - MAX_LISTED } : {}),
  }
}

function coverageSentence(crawl: CrawlSummary): string {
  const checked = Object.keys(crawl.linkStatus).length
  const parts = [`${checked} of the ${crawl.linksFound} same-origin links on this page were checked`]
  if (crawl.linksDisallowed > 0) parts.push(`${crawl.linksDisallowed} were excluded by robots.txt`)
  return `${parts.join(', ')}.`
}

/** Paths read better than absolute URLs in a list that is all one origin. */
function pathOf(url: string, ctx: CheckContext): string {
  try {
    const parsed = new URL(url)
    return parsed.origin === ctx.finalUrl.origin ? `${parsed.pathname}${parsed.search}` : url
  } catch {
    return url
  }
}
