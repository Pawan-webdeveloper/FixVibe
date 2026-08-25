/**
 * The bounded crawl and the two checks that read it.
 *
 * Two themes run through these tests.
 *
 * First, a fast scan must be indistinguishable from before this feature
 * existed. `ctx.crawl` absent means we never looked, and a check that treats
 * "never looked" as "nothing there" would start reporting the absence of
 * evidence it did not go and collect.
 *
 * Second, broken-links is one bad status code away from being a false-positive
 * machine. Most of its cases below are status codes it must NOT report — 401,
 * 403, 429 and the rest all have innocent readings, and a members' area or a
 * WAF that dislikes our user-agent is not a broken link.
 *
 * crawlSite() itself does network I/O through safeFetch, whose SSRF guard
 * blocks the loopback addresses a test server would need, so its orchestration
 * is covered by the live smoke test and its pure parts are covered here.
 */

import * as cheerio from 'cheerio'
import { describe, expect, it } from 'vitest'
import { diversify, sameOriginLinks } from '../src/context/crawl.ts'
import { brokenLinksCheck } from '../src/seo/broken-links.ts'
import { duplicateMetadataCheck } from '../src/seo/duplicate-metadata.ts'
import { crawledPage, crawlSummary, makeContext, pageHtml } from './helpers.ts'

const ROOT = new URL('https://site.test/')

const linksHtml = (...hrefs: string[]) =>
  cheerio.load(`<html><body>${hrefs.map((href) => `<a href="${href}">x</a>`).join('')}</body></html>`)

describe('sameOriginLinks', () => {
  it('keeps same-origin links, resolves relatives, and drops the fragment', () => {
    const $ = linksHtml('/pricing', 'about', 'https://site.test/docs#install', '/pricing#top')
    expect(sameOriginLinks($, ROOT)).toEqual([
      'https://site.test/pricing',
      'https://site.test/about',
      'https://site.test/docs',
    ])
  })

  it('excludes every other origin and scheme', () => {
    // Outbound links are a different feature with different ethics: checking
    // them means issuing requests to third parties who never asked to be
    // scanned. mailto/tel/javascript fall out of the same origin test.
    const $ = linksHtml(
      'https://other.test/x',
      'http://site.test/insecure', // different scheme = different origin
      'https://site.test:8443/x', // different port = different origin
      'mailto:hi@site.test',
      'tel:+123',
      'javascript:void(0)',
      '//cdn.other.test/a',
    )
    expect(sameOriginLinks($, ROOT)).toEqual([])
  })

  it('never returns the page it was given', () => {
    const $ = linksHtml('/', 'https://site.test/', '#section', '/other')
    expect(sameOriginLinks($, ROOT)).toEqual(['https://site.test/other'])
  })

  it('drops hrefs that do not parse at all', () => {
    const $ = linksHtml('http://', '/real')
    expect(sameOriginLinks($, ROOT)).toEqual(['https://site.test/real'])
  })

  it('keeps an unrendered template placeholder, because a browser would request it too', () => {
    // href="{{ url }}" is a real link as far as the browser is concerned: it
    // resolves to a same-origin path and requesting it returns 404. That is a
    // genuine defect on the page, so collecting it — and letting broken-links
    // report the 404 — is right. Filtering it out would hide a bug.
    const $ = linksHtml('{{ url }}', '/real')
    expect(sameOriginLinks($, ROOT)).toEqual(['https://site.test/%7B%7B%20url%20%7D%7D', 'https://site.test/real'])
  })
})

describe('diversify', () => {
  it('spends the budget on breadth rather than one section', () => {
    // A blog index would otherwise consume the whole budget on posts and the
    // crawl would never see /pricing or /about. Round-robin, so the two
    // top-level pages appear immediately rather than after six blog posts.
    const posts = Array.from({ length: 10 }, (_, i) => `https://site.test/blog/post-${i}`)
    const ordered = diversify([...posts, 'https://site.test/pricing', 'https://site.test/about'], ROOT)

    // One per section per round: a blog post, then the two top-level pages,
    // then the next blog post — rather than six posts before anything else.
    expect(ordered.slice(0, 4)).toEqual([
      'https://site.test/blog/post-0',
      'https://site.test/pricing',
      'https://site.test/blog/post-1',
      'https://site.test/about',
    ])
    // Six posts get in before the seventh is deferred to the tail.
    expect(ordered.indexOf('https://site.test/blog/post-5')).toBeLessThan(
      ordered.indexOf('https://site.test/blog/post-6'),
    )
    expect(ordered.slice(-4)).toEqual(posts.slice(6))
  })

  it('sections by parent path, so a locale prefix does not defeat the cap', () => {
    // Every link on stripe.com starts /in/. Keying on the first segment put
    // all 110 of them in one bucket and capped nothing at all.
    const links = [
      'https://site.test/in/customers/a',
      'https://site.test/in/customers/b',
      'https://site.test/in/newsroom/x',
      'https://site.test/in/pricing',
    ]
    expect(diversify(links, ROOT).slice(0, 3)).toEqual([
      'https://site.test/in/customers/a',
      'https://site.test/in/newsroom/x',
      'https://site.test/in/pricing',
    ])
  })

  it('reorders without dropping anything — the budget is applied later', () => {
    const links = Array.from({ length: 20 }, (_, i) => `https://site.test/blog/${i}`)
    expect(diversify(links, ROOT).sort()).toEqual([...links].sort())
  })

  it('is stable, so two scans of an unchanged site crawl the same pages', () => {
    const links = ['https://site.test/a/1', 'https://site.test/b/1', 'https://site.test/a/2']
    expect(diversify(links, ROOT)).toEqual(diversify(links, ROOT))
  })
})

describe('crawl output guarantees', () => {
  it('never hands a non-2xx response to the page comparisons', async () => {
    // Custom 404 pages have a <title> too. Three of them sharing "Page not
    // found" is broken-links' finding, not a duplicate-metadata one — and
    // crawlSite only promotes 2xx HTML into `pages`, so this shape cannot
    // reach the check at all. Asserted here as the contract it is.
    const crawl = crawlSummary({
      pages: [],
      linkStatus: {
        'https://site.test/old-pricing': 404,
        'https://site.test/blog/deleted': 404,
        'https://site.test/docs/v1': 404,
      },
    })
    expect(await duplicateMetadataCheck.run(makeContext({ crawl }))).toEqual([])
    expect(await brokenLinksCheck.run(makeContext({ crawl }))).toHaveLength(1)
  })
})

describe('seo.broken-links', () => {
  it('says nothing on a fast scan, which never followed a link', async () => {
    const ctx = makeContext()
    expect(ctx.crawl).toBeUndefined()
    expect(await brokenLinksCheck.run(ctx)).toEqual([])
  })

  it('stays silent when every link resolved', async () => {
    const crawl = crawlSummary({
      linkStatus: { 'https://site.test/a': 200, 'https://site.test/b': 301, 'https://site.test/c': 204 },
    })
    expect(await brokenLinksCheck.run(makeContext({ crawl }))).toEqual([])
  })

  it('reports 404 and 410 and nothing else that merely looks like failure', async () => {
    const crawl = crawlSummary({
      linkStatus: {
        'https://site.test/gone': 404,
        'https://site.test/retired': 410,
        'https://site.test/members': 401, // needs a login
        'https://site.test/blocked': 403, // a WAF dislikes our user-agent
        'https://site.test/throttled': 429, // our fault, not the site's
        'https://site.test/no-get': 405, // says nothing about the resource
        'https://site.test/moved': 302, // resolves; the crawl followed it
      },
    })
    const findings = await brokenLinksCheck.run(makeContext({ crawl }))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toBe('2 broken links on this page')
    const listed = JSON.stringify(findings[0]?.evidence)
    for (const innocent of ['members', 'blocked', 'throttled', 'no-get', 'moved']) {
      expect(listed, `${innocent} must not be reported as broken`).not.toContain(innocent)
    }
  })

  it('cannot see a link it failed to reach', async () => {
    // A url absent from linkStatus is one the crawl could not fetch. A timeout
    // on our side must never be published as a defect on someone else's site.
    const crawl = crawlSummary({ linkStatus: {}, linksFound: 12 })
    expect(await brokenLinksCheck.run(makeContext({ crawl }))).toEqual([])
  })

  it('separates server errors from routing mistakes', async () => {
    const crawl = crawlSummary({
      linkStatus: { 'https://site.test/gone': 404, 'https://site.test/boom': 500, 'https://site.test/gw': 503 },
    })
    const findings = await brokenLinksCheck.run(makeContext({ crawl }))
    expect(findings.map((finding) => finding.title)).toEqual([
      '1 broken link on this page',
      '2 links on this page returned a server error',
    ])
    // A 5xx is an application bug, so the prompt must not tell an agent to
    // rewrite the href.
    expect(findings[1]?.fixPrompt).toContain('do NOT change')
  })

  it('scales severity with how many links are dead', async () => {
    const dead = (count: number) =>
      crawlSummary({
        linkStatus: Object.fromEntries(Array.from({ length: count }, (_, i) => [`https://site.test/x${i}`, 404])),
      })
    expect((await brokenLinksCheck.run(makeContext({ crawl: dead(1) })))[0]?.severity).toBe('low')
    expect((await brokenLinksCheck.run(makeContext({ crawl: dead(5) })))[0]?.severity).toBe('medium')
  })

  it('publishes the denominators instead of implying it checked everything', async () => {
    const crawl = crawlSummary({
      linkStatus: { 'https://site.test/gone': 404 },
      linksFound: 300,
      linksSkipped: 275,
      linksDisallowed: 24,
    })
    const findings = await brokenLinksCheck.run(makeContext({ crawl }))
    expect(findings[0]?.evidence).toMatchObject({
      linksChecked: 1,
      linksFound: 300,
      linksNotChecked: 275,
      linksExcludedByRobotsTxt: 24,
    })
    expect(findings[0]?.description).toContain('1 of the 300 same-origin links')
    expect(findings[0]?.description).toContain('24 were excluded by robots.txt')
  })

  it('caps the list it prints and counts the remainder', async () => {
    const crawl = crawlSummary({
      linkStatus: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`https://site.test/x${i}`, 404])),
    })
    const evidence = (await brokenLinksCheck.run(makeContext({ crawl })))[0]?.evidence as Record<string, unknown>
    expect((evidence['broken'] as string[]).length).toBe(12)
    expect(evidence['notListed']).toBe(8)
  })
})

describe('seo.duplicate-metadata', () => {
  const root = pageHtml('Acme — Home', 'The Acme home page.')

  /** A page declaring a canonical, i.e. telling us which URL it really is. */
  const canonicalPage = (title: string, canonical: string) =>
    '<!doctype html><html lang="en"><head>' +
    `<title>${title}</title><link rel="canonical" href="${canonical}" />` +
    '</head><body><h1>x</h1></body></html>'

  it('treats pages that declare the same canonical as one page', async () => {
    // A Next.js site with a default locale serves / and /en identically, both
    // pointing a canonical at /. That is the site doing exactly the right
    // thing, and reporting it as duplicate titles would be scolding it for it.
    const crawl = crawlSummary({
      pages: [crawledPage('/en', canonicalPage('Acme — Home', 'https://site.test/'))],
    })
    const ctx = makeContext({ html: canonicalPage('Acme — Home', 'https://site.test/'), crawl })
    expect(await duplicateMetadataCheck.run(ctx)).toEqual([])
  })

  it('still flags two genuinely distinct pages that share a title', async () => {
    const crawl = crawlSummary({
      pages: [
        crawledPage('/careers', canonicalPage('Careers — Acme', 'https://site.test/careers')),
        crawledPage('/careers/eng', canonicalPage('Careers — Acme', 'https://site.test/careers/eng')),
      ],
    })
    const findings = await duplicateMetadataCheck.run(makeContext({ html: root, crawl }))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.title).toBe('2 pages share the same title')
  })

  it('says nothing on a fast scan', async () => {
    expect(await duplicateMetadataCheck.run(makeContext({ html: root }))).toEqual([])
  })

  it('stays silent when every page has its own metadata', async () => {
    const crawl = crawlSummary({
      pages: [
        crawledPage('/pricing', pageHtml('Pricing — Acme', 'What Acme costs.')),
        crawledPage('/about', pageHtml('About — Acme', 'Who builds Acme.')),
      ],
    })
    expect(await duplicateMetadataCheck.run(makeContext({ html: root, crawl }))).toEqual([])
  })

  it('flags a title repeated across pages, including the root', async () => {
    const crawl = crawlSummary({
      pages: [
        crawledPage('/pricing', pageHtml('Acme — Home', 'What Acme costs.')),
        crawledPage('/about', pageHtml('About — Acme', 'Who builds Acme.')),
      ],
    })
    const findings = await duplicateMetadataCheck.run(makeContext({ html: root, crawl }))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('medium')
    expect(findings[0]?.title).toBe('2 pages share the same title')
    expect(findings[0]?.evidence).toMatchObject({
      pagesCompared: 3,
      duplicates: [{ title: 'acme — home', pages: ['/', '/pricing'] }],
    })
  })

  it('treats whitespace and casing differences as the same title', async () => {
    // A search engine does; reporting them as distinct would hide the defect
    // behind a formatting difference.
    const crawl = crawlSummary({ pages: [crawledPage('/p', pageHtml('  ACME  —   Home  ', 'Other.'))] })
    const findings = await duplicateMetadataCheck.run(makeContext({ html: root, crawl }))
    expect(findings).toHaveLength(1)
  })

  it('rates a duplicated description below a duplicated title', async () => {
    const crawl = crawlSummary({ pages: [crawledPage('/p', pageHtml('Pricing — Acme', 'The Acme home page.'))] })
    const findings = await duplicateMetadataCheck.run(makeContext({ html: root, crawl }))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('low')
    expect(findings[0]?.title).toContain('meta description')
  })

  it('leaves missing metadata to the checks that own it', async () => {
    // Three pages with no title at all are not "sharing" one — that is
    // seo.title's finding, and charging it twice would double the penalty.
    const bare = '<!doctype html><html><head></head><body><h1>x</h1></body></html>'
    const crawl = crawlSummary({ pages: [crawledPage('/a', bare), crawledPage('/b', bare)] })
    expect(await duplicateMetadataCheck.run(makeContext({ html: bare, crawl }))).toEqual([])
  })

  it('reports both kinds when both are duplicated', async () => {
    const crawl = crawlSummary({ pages: [crawledPage('/p', root)] })
    const findings = await duplicateMetadataCheck.run(makeContext({ html: root, crawl }))
    expect(findings.map((finding) => finding.severity)).toEqual(['medium', 'low'])
  })
})
