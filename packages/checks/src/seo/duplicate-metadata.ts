/**
 * The same <title> or meta description on more than one page.
 *
 * Titles and descriptions are the two things a search engine shows a person
 * deciding whether to click. When several pages share them, the engine has to
 * pick which one to rank for a query and the others compete against it —
 * Search Console reports this as "Duplicate without user-selected canonical".
 * More practically, a results page listing four identical blue links is one
 * the user scrolls past.
 *
 * Almost always this is a template that renders a constant where it should
 * render the page's own data: `<title>My Site</title>` on every route, or a
 * layout-level description that the page never overrides.
 *
 * ## Why this needs the crawl, and what it can honestly claim
 *
 * Duplication is invisible from one document by definition. This check
 * compares the home page with the sub-pages a `deep` scan fetched, which is a
 * handful of pages, not the site. So a hit is a true positive — two pages
 * really do share a title, we read both — while silence means nothing at all.
 * The wording says which pages were compared for exactly that reason.
 *
 * Pages are deduplicated by their FINAL url upstream, so `/about` redirecting
 * to `/about/` is one page, not two pages that suspiciously share everything.
 */

import * as cheerio from 'cheerio'
import type { Check, CheckContext, Finding } from '../types.ts'

const ID = 'seo.duplicate-metadata'

/** Groups listed in the report before the rest are counted. */
const MAX_GROUPS_LISTED = 5

interface Page {
  label: string
  title: string
  description: string
}

export const duplicateMetadataCheck: Check = {
  id: ID,
  category: 'seo',
  title: 'Duplicate titles and descriptions',

  run(ctx) {
    // Fast scan: only one page was ever fetched, so there is nothing to compare.
    const crawl = ctx.crawl
    if (!crawl || crawl.pages.length === 0) return []

    const pages: Page[] = [
      { label: labelFor(ctx.finalUrl.href, ctx), ...metadataFrom(ctx.$) },
      ...crawl.pages.map((page) => ({
        label: labelFor(page.finalUrl, ctx),
        ...metadataFrom(cheerio.load(headOf(page.html))),
      })),
    ]
    if (pages.length < 2) return []

    const findings: Finding[] = []

    const titleGroups = groupBy(pages, (page) => page.title)
    if (titleGroups.length > 0) findings.push(duplicateFinding(ctx, 'title', titleGroups, pages.length))

    const descriptionGroups = groupBy(pages, (page) => page.description)
    if (descriptionGroups.length > 0) {
      findings.push(duplicateFinding(ctx, 'description', descriptionGroups, pages.length))
    }

    return findings
  },
}

type Group = { value: string; pages: string[] }

function duplicateFinding(
  ctx: CheckContext,
  kind: 'title' | 'description',
  groups: Group[],
  compared: number,
): Finding {
  const affected = groups.reduce((total, group) => total + group.pages.length, 0)
  const noun = kind === 'title' ? 'title' : 'meta description'
  const listed = groups.slice(0, MAX_GROUPS_LISTED)

  return {
    checkId: ID,
    category: 'seo',
    // A shared title is the more damaging of the two: it is the ranked and
    // clicked element, and it is what Search Console groups pages by.
    severity: kind === 'title' ? 'medium' : 'low',
    title: `${affected} pages share ${groups.length === 1 ? 'the same' : 'a duplicated'} ${noun}`,
    description:
      `Of the ${compared} pages examined, ${affected} carry ${
        groups.length === 1 ? 'an identical' : 'a duplicated'
      } ${noun}. Search engines have to choose one of them to show for a query and the rest compete ` +
      `with it, so pages that should each rank for their own topic dilute one another. This is ` +
      `almost always a layout rendering a constant ${noun} that individual pages never override. ` +
      `Only these ${compared} pages were compared, so there may be more.`,
    evidence: {
      pagesCompared: compared,
      duplicates: listed.map((group) => ({ [kind]: truncate(group.value), pages: group.pages })),
      ...(groups.length > MAX_GROUPS_LISTED ? { groupsNotListed: groups.length - MAX_GROUPS_LISTED } : {}),
    },
    remediation:
      `Give every page its own ${noun}, describing what is on that page rather than what the site is.`,
    fixPrompt:
      `These pages on ${ctx.finalUrl.origin} share the same ${noun}:\n\n` +
      listed
        .map(
          (group) =>
            `  ${JSON.stringify(truncate(group.value))}\n${group.pages.map((page) => `    - ${page}`).join('\n')}`,
        )
        .join('\n\n') +
      '\n\nFind where the ' +
      (kind === 'title' ? '<title>' : 'meta description') +
      ' is set. In a framework this is usually one shared place — a root layout, a `metadata` export, ' +
      'a document head component, or a CMS template — and the fix is to make it per-page rather than ' +
      'to hard-code a different constant in each file.\n\n' +
      (kind === 'title'
        ? 'Give each page a title built from its own content, ideally with a shared suffix: ' +
          '"Pricing — Acme", "About us — Acme". Keep it under about 60 characters so it is not ' +
          'truncated in results. If the framework supports a title template (for example Next.js\'s ' +
          '`title: { template: "%s — Acme", default: "Acme" }`), set it once in the root layout and ' +
          'have each page supply only its own part.'
        : 'Write a description per page, roughly 120–160 characters, summarising that page ' +
          'specifically. Do not generate them from the first paragraph mechanically — a description ' +
          'that reads like a fragment performs worse than none at all, and a page with no description ' +
          'at least lets the engine pick relevant text itself.') +
      '\n\nCheck the other pages of the site too: only a sample was examined here, so the same ' +
      'template almost certainly affects routes this scan never fetched.',
  }
}

/**
 * The document down to `</head>`.
 *
 * Titles and descriptions only ever live in the head, and a crawled page can
 * be half a megabyte of body markup — parsing ten of those in full was most of
 * what a deep scan spent its time on. Falls back to a bounded prefix when the
 * page has no closing head tag, so a malformed document still gets read rather
 * than skipped.
 */
function headOf(html: string): string {
  const end = html.toLowerCase().indexOf('</head>')
  return end === -1 ? html.slice(0, 64 * 1024) : html.slice(0, end)
}

/** `<title>` and `<meta name="description">` of one document, normalized for comparison. */
function metadataFrom($: cheerio.CheerioAPI): { title: string; description: string } {
  const description = $('meta')
    .filter((_, element) => ($(element).attr('name') ?? '').trim().toLowerCase() === 'description')
    .first()
    .attr('content')

  return { title: normalize($('title').first().text()), description: normalize(description ?? '') }
}

/**
 * Case- and whitespace-insensitive. Two titles differing only in trailing
 * whitespace are the same title to a search engine, and reporting them as
 * distinct would hide the defect behind a formatting difference.
 */
function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Groups sharing a non-empty value, largest first. An EMPTY value is skipped:
 * pages with no title at all are seo.title's finding, and reporting them here
 * as well would charge the same defect twice.
 */
function groupBy(pages: readonly Page[], pick: (page: Page) => string): Group[] {
  const byValue = new Map<string, string[]>()
  for (const page of pages) {
    const value = pick(page)
    if (!value) continue
    byValue.set(value, [...(byValue.get(value) ?? []), page.label])
  }

  return [...byValue.entries()]
    .filter(([, labels]) => labels.length > 1)
    .map(([value, labels]) => ({ value, pages: labels }))
    .sort((a, b) => b.pages.length - a.pages.length || a.value.localeCompare(b.value))
}

/** Paths read better than absolute URLs in a list that is all one origin. */
function labelFor(url: string, ctx: CheckContext): string {
  try {
    const parsed = new URL(url)
    return parsed.origin === ctx.finalUrl.origin ? parsed.pathname : url
  } catch {
    return url
  }
}

function truncate(value: string, limit = 120): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}
