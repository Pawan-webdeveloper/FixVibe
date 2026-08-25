/**
 * Bounded same-origin crawl.
 *
 * Everything in the engine so far judges one page. That is honest but narrow:
 * a broken link, a duplicated title, a section of the site with none of the
 * markup the home page has — none of it is visible from a single document. So
 * a `deep` scan follows the home page's own links, briefly, and hands the
 * checks what it found.
 *
 * ## The rules this crawl holds itself to
 *
 * **robots.txt applies here, and deliberately not to the root page.** A person
 * pasting one URL into a scanner is not a crawler and gets that URL fetched
 * whatever robots says. Following links autonomously IS crawling, so every
 * link is checked against the site's rules for our user-agent first. Links
 * excluded that way are counted, never reported — a disallowed URL is not a
 * broken one, and a check that confused the two would tell people their site
 * was broken because they asked us not to look.
 *
 * **Same origin only.** Not the same registrable domain — the same
 * scheme/host/port. Checking outbound links means issuing requests to third
 * parties who never asked to be scanned, which is a different feature with
 * different ethics, and one bad third-party link would make us the tool that
 * hammered somebody's server.
 *
 * **One request per URL, and a hard ceiling on them.** Link statuses and page
 * bodies come from the same pass: the first pages that answer with HTML keep
 * their markup for the content checks, everything else contributes only its
 * status code. Fetching a URL twice for two purposes would double the load we
 * put on a site to learn nothing new.
 *
 * **A fetch that failed is not a fact.** A timeout, a reset connection, a DNS
 * hiccup — those are omitted from `linkStatus` entirely rather than recorded
 * as some sentinel. Downstream, "not present" reads as "we do not know", which
 * is what it is; a check must never report a transient network error on our
 * side as a defect on the customer's site.
 */

import type { CheerioAPI } from 'cheerio'
import type { CheckContext } from '../types.ts'
import { safeFetch } from './safe-fetch.ts'

/** URLs we will request in total. The politeness budget for the whole crawl. */
const MAX_LINKS = 25
/** Of those, how many may keep their HTML. Bodies are what cost memory downstream. */
const MAX_HTML_PAGES = 10
/** In-flight requests. Four is brisk without looking like a load test. */
const CONCURRENCY = 4
/**
 * Per section, where a section is a link's PARENT path. Without a cap a blog
 * index spends the entire budget on twenty-five posts and the crawl never sees
 * /pricing, /about or /contact.
 *
 * Parent path rather than first segment, because the first segment is the
 * locale on a great many sites: every link on stripe.com starts /in/, so
 * "first segment" put all 110 of them in one bucket and capped nothing.
 */
const MAX_PER_SECTION = 6

const PAGE_TIMEOUT_MS = 8_000
const PAGE_MAX_BODY_BYTES = 512 * 1024

/** The token a robots.txt would name us by (see SCANNER_USER_AGENT). */
const ROBOTS_TOKEN = 'darvinscanner'

export interface CrawlResult {
  /**
   * Pages whose HTML was kept, in the order they were requested. Deduplicated
   * by FINAL url, so `/about` and `/about/` collapse into one entry when they
   * are the same page — otherwise every check comparing pages against each
   * other would find an imaginary duplicate.
   */
  pages: Array<{ url: string; finalUrl: string; status: number; html: string }>
  /**
   * Requested url → the status it ultimately answered with, redirects
   * followed. A url that failed to fetch at all is ABSENT, meaning unknown.
   */
  linkStatus: Record<string, number>
  /** Same-origin links found on the root page, before any budget was applied. */
  linksFound: number
  /** Of those, how many were never requested because the budget ran out. */
  linksSkipped: number
  /** How many robots.txt told us not to fetch. Never a defect — just coverage we do not have. */
  linksDisallowed: number
}

export async function crawlSite(
  $: CheerioAPI,
  rootUrl: URL,
  robots: CheckContext['robots'],
): Promise<CrawlResult> {
  const candidates = sameOriginLinks($, rootUrl)

  const allowed: string[] = []
  let linksDisallowed = 0
  for (const href of candidates) {
    // No robots.txt (or one we could not fetch) means no restriction stated.
    if (robots && !robots.allows(ROBOTS_TOKEN, new URL(href).pathname)) {
      linksDisallowed += 1
      continue
    }
    allowed.push(href)
  }

  const targets = diversify(allowed, rootUrl).slice(0, MAX_LINKS)

  const linkStatus: Record<string, number> = {}
  const pages: CrawlResult['pages'] = []
  const seenFinalUrls = new Set<string>([rootUrl.href])

  await inBatches(targets, CONCURRENCY, async (href) => {
    const fetched = await fetchPage(href)
    if (!fetched) return // unknown, and unknown stays out of the record

    linkStatus[href] = fetched.status

    if (!fetched.html || pages.length >= MAX_HTML_PAGES) return
    // Dedup on where we LANDED: a redirect from /about to /about/ is one page.
    if (seenFinalUrls.has(fetched.finalUrl)) return
    seenFinalUrls.add(fetched.finalUrl)
    pages.push({ url: href, finalUrl: fetched.finalUrl, status: fetched.status, html: fetched.html })
  })

  return {
    pages,
    linkStatus,
    linksFound: candidates.length,
    linksSkipped: Math.max(0, allowed.length - targets.length),
    linksDisallowed,
  }
}

interface FetchedPage {
  finalUrl: string
  status: number
  /** Empty unless the response was HTML — a PDF's bytes are of no use to any check. */
  html: string
}

async function fetchPage(href: string): Promise<FetchedPage | null> {
  try {
    const response = await safeFetch(href, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBodyBytes: PAGE_MAX_BODY_BYTES,
    })
    const isHtml = (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')
    return {
      finalUrl: response.finalUrl.href,
      status: response.status,
      html: isHtml ? response.body : '',
    }
  } catch {
    // Timeout, reset, blocked by the SSRF guard after a redirect. All of these
    // mean we learned nothing, and nothing is what we report.
    return null
  }
}

/**
 * Same-origin `<a href>` targets from the document, fragments stripped,
 * deduplicated, in document order.
 *
 * Document order matters: it is deterministic, and on almost every site the
 * navigation comes first, so the head of this list is the site's own idea of
 * its important pages.
 */
export function sameOriginLinks($: CheerioAPI, rootUrl: URL): string[] {
  const found = new Set<string>()

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href')
    if (!href) return

    let url: URL
    try {
      url = new URL(href, rootUrl)
    } catch {
      return // unresolvable, or a template placeholder that survived rendering
    }

    // Also excludes mailto:, tel: and javascript:, whose origin is never ours.
    if (url.origin !== rootUrl.origin) return

    url.hash = ''
    if (url.href === rootUrl.href) return // the page we are already holding

    found.add(url.href)
  })

  return [...found]
}

/**
 * Reorders links so the budget buys breadth rather than one deep section.
 *
 * Pass one takes up to MAX_PER_SECTION links from each section, in document
 * order; pass two appends whatever is left, so nothing is dropped before the
 * budget is applied — only reordered. Stable and deterministic, so two scans
 * of an unchanged site crawl the same pages.
 */
export function diversify(links: readonly string[], rootUrl: URL): string[] {
  const section = (href: string) => {
    try {
      const segments = new URL(href, rootUrl).pathname.split('/').filter(Boolean)
      // The parent path: /in/customers/ramp and /in/customers/shopify share a
      // section, while /in/pricing does not belong to either.
      return segments.slice(0, -1).join('/')
    } catch {
      return ''
    }
  }

  // Bucket by section, preserving document order inside each.
  const bySection = new Map<string, string[]>()
  for (const href of links) {
    const key = section(href)
    bySection.set(key, [...(bySection.get(key) ?? []), href])
  }

  // Round-robin, not six-in-a-row. Taking MAX_PER_SECTION consecutive links
  // from the first section fills the head of the budget with one blog and
  // defeats the point; one from each section per round spreads it properly.
  // Section order is order of first appearance, so this stays deterministic.
  const picked: string[] = []
  const rest: string[] = []
  for (let round = 0; round < MAX_PER_SECTION; round += 1) {
    for (const hrefs of bySection.values()) {
      const href = hrefs[round]
      if (href !== undefined) picked.push(href)
    }
  }
  for (const hrefs of bySection.values()) rest.push(...hrefs.slice(MAX_PER_SECTION))

  return [...picked, ...rest]
}

/** Runs `work` over `items` with a fixed number in flight. Order of completion is irrelevant. */
async function inBatches<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      if (item !== undefined) await work(item)
    }
  })
  await Promise.all(runners)
}
