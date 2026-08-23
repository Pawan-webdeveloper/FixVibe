/**
 * Unit tests for the eight AEO checks.
 *
 * This pillar makes claims about how AI assistants read a site, which is easy
 * to turn into horoscope advice. So most of what follows pins the scope
 * decisions rather than the happy paths: no FAQ schema nagging on pages with no
 * FAQ, no author complaints on a pricing page, no "your site is invisible" on a
 * page that is merely short, and no calling a deliberate block of GPTBot a
 * mistake.
 */

import { describe, expect, it } from 'vitest'
import type { Check, Finding } from '../src/types.ts'
import { aiBotsAllowedCheck } from '../src/aeo/ai-bots-allowed.ts'
import { answerStructureCheck } from '../src/aeo/answer-structure.ts'
import { authorDateCheck } from '../src/aeo/author-date.ts'
import { entitySchemaCheck } from '../src/aeo/entity-schema.ts'
import { faqHowToSchemaCheck } from '../src/aeo/faq-howto-schema.ts'
import { llmsTxtCheck } from '../src/aeo/llms-txt.ts'
import { outboundCitationsCheck } from '../src/aeo/outbound-citations.ts'
import { ssrContentCheck } from '../src/aeo/ssr-content.ts'
import { LLMS_TXT, makeContext, probeStub, robotsFrom, type ContextOverrides } from './helpers.ts'

const run = async (check: Check, overrides: ContextOverrides = {}): Promise<Finding[]> =>
  check.run(makeContext(overrides))

const only = (findings: Finding[]): Finding => {
  expect(findings).toHaveLength(1)
  return findings[0]!
}

const page = (body: string, head = ''): string =>
  `<!doctype html><html lang="en"><head><title>t</title>${head}</head><body>${body}</body></html>`

/** `n` words of filler, so a length threshold is crossed by content, not by markup. */
const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(' ')

const ld = (json: unknown): string =>
  `<script type="application/ld+json">${JSON.stringify(json)}</script>`

// ---------------------------------------------------------------------------

describe('aeo.ssr-content', () => {
  const shell = page('<div id="root"></div>')

  it('flags an empty framework shell filled in by JavaScript', async () => {
    const ctx = makeContext({ html: shell })
    ctx.scripts.push({ url: 'https://site.test/assets/index-abc.js', content: '' })
    const findings = await ssrContentCheck.run(ctx)
    expect(only(findings).severity).toBe('high')
    expect(only(findings).evidence).toMatchObject({ mountPoint: '#root', externalScripts: 1 })
  })

  it.each(['#__next', '#app', '#___gatsby'])('recognises the %s mount point too', async (mount) => {
    const ctx = makeContext({ html: page(`<div id="${mount.slice(1)}"></div>`) })
    ctx.scripts.push({ url: 'https://site.test/bundle.js', content: '' })
    expect(await ssrContentCheck.run(ctx)).toHaveLength(1)
  })

  it('stays silent on a page that is simply short', async () => {
    // A holding page with no shell and no bundle is not a rendering problem.
    expect(await run(ssrContentCheck, { html: page('<h1>Coming soon</h1>') })).toEqual([])
  })

  it('stays silent when a mount point exists but nothing will fill it', async () => {
    expect(await run(ssrContentCheck, { html: shell })).toEqual([])
  })

  it('stays silent when the shell already contains the content', async () => {
    const ctx = makeContext({ html: page(`<div id="root"><article>${words(60)}</article></div>`) })
    ctx.scripts.push({ url: 'https://site.test/bundle.js', content: '' })
    expect(await ssrContentCheck.run(ctx)).toEqual([])
  })

  it('does not count script contents as page text', async () => {
    // cheerio's .text() includes <script> bodies; without stripping them a
    // large inline JSON payload makes an empty app look content-rich.
    const html = page(`<div id="root"></div><script>${JSON.stringify({ filler: words(200) })}</script>`)
    const ctx = makeContext({ html })
    ctx.scripts.push({ url: 'https://site.test/bundle.js', content: '' })
    expect(await ssrContentCheck.run(ctx)).toHaveLength(1)
  })
})

describe('aeo.ai-bots-allowed', () => {
  const allowAll = robotsFrom('User-agent: *\nAllow: /\n')
  const blockAi = robotsFrom('User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n')

  it('says nothing when there is no robots.txt', async () => {
    expect(await run(aiBotsAllowedCheck, { robots: null })).toEqual([])
  })

  it('says nothing when every AI crawler is allowed', async () => {
    expect(await run(aiBotsAllowedCheck, { robots: allowAll })).toEqual([])
  })

  it('records a block as an observation, not a defect', async () => {
    // Keeping content out of model training is a policy, not a mistake. A
    // scanner that scores it as one is substituting its opinion for the owner's.
    const findings = await run(aiBotsAllowedCheck, { robots: blockAi })
    expect(only(findings).severity).toBe('info')
    expect(only(findings).title).toContain('2 AI crawlers blocked')
  })

  it('catches a site-wide block that catches AI crawlers with everything else', async () => {
    const findings = await run(aiBotsAllowedCheck, { robots: robotsFrom('User-agent: *\nDisallow: /\n') })
    expect(only(findings).severity).toBe('info')
  })

  it('escalates when llms.txt invites the crawlers robots.txt turns away', async () => {
    // Two policies, one of which is doing nothing. That is a real defect.
    const findings = await run(aiBotsAllowedCheck, {
      robots: blockAi,
      probe: probeStub({ '/llms.txt': { status: 200, body: LLMS_TXT } }),
    })
    expect(only(findings).severity).toBe('low')
    expect(only(findings).title).toContain('llms.txt')
  })

  it('does not treat an app shell at /llms.txt as a contradiction', async () => {
    const findings = await run(aiBotsAllowedCheck, {
      robots: blockAi,
      probe: probeStub({ '/llms.txt': { status: 200, body: '<!doctype html><html></html>' } }),
    })
    expect(only(findings).severity).toBe('info')
  })
})

describe('aeo.llms-txt', () => {
  it('says nothing when the probe could not reach the path', async () => {
    expect(await run(llmsTxtCheck, { probe: probeStub({}) })).toEqual([])
  })

  it('reports absence as an opportunity, never as a defect', async () => {
    const findings = await run(llmsTxtCheck, { probe: probeStub({ '/llms.txt': { status: 404 } }) })
    expect(only(findings).severity).toBe('info')
  })

  it('accepts a real markdown file', async () => {
    const findings = await run(llmsTxtCheck, {
      probe: probeStub({ '/llms.txt': { status: 200, body: LLMS_TXT } }),
    })
    expect(findings).toEqual([])
  })

  it('flags a catch-all route answering with the app shell', async () => {
    const findings = await run(llmsTxtCheck, {
      probe: probeStub({ '/llms.txt': { status: 200, body: '<!doctype html><html><body>App</body></html>' } }),
    })
    expect(only(findings).severity).toBe('low')
    expect(only(findings).title).toContain('HTML')
  })
})

describe('aeo.entity-schema', () => {
  const organization = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Acme',
    sameAs: ['https://github.com/acme'],
  }

  it('only looks at the home page', async () => {
    // An Organization node belongs at the root; asking every blog post for one
    // is coverage for its own sake.
    expect(await run(entitySchemaCheck, { url: 'https://site.test/blog/post', html: page('') })).toEqual([])
  })

  it('flags a home page with no entity declared', async () => {
    const findings = await run(entitySchemaCheck, { html: page('') })
    expect(only(findings).severity).toBe('info')
    expect(only(findings).title).toContain('No Organization or Person')
  })

  it('does not accept a WebSite node as an entity declaration', async () => {
    const head = ld({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Acme' })
    expect(await run(entitySchemaCheck, { html: page('', head) })).toHaveLength(1)
  })

  it('accepts an Organization with sameAs', async () => {
    expect(await run(entitySchemaCheck, { html: page('', ld(organization)) })).toEqual([])
  })

  it('finds the entity inside a @graph container', async () => {
    const head = ld({
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'WebSite', name: 'Acme' }, organization],
    })
    expect(await run(entitySchemaCheck, { html: page('', head) })).toEqual([])
  })

  it('accepts an array-valued @type', async () => {
    const head = ld({ ...organization, '@type': ['Organization', 'LocalBusiness'] })
    expect(await run(entitySchemaCheck, { html: page('', head) })).toEqual([])
  })

  it('flags an entity that links to nothing', async () => {
    const head = ld({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' })
    const findings = await run(entitySchemaCheck, { html: page('', head) })
    expect(only(findings).title).toContain('sameAs')
    expect(only(findings).evidence).toMatchObject({ entities: ['Acme'] })
  })
})

describe('aeo.answer-structure', () => {
  it('leaves short pages alone — one heading is a complete structure', async () => {
    expect(await run(answerStructureCheck, { html: page(`<p>${words(100)}</p>`) })).toEqual([])
  })

  it('flags a long page with no subheadings', async () => {
    const body = Array.from({ length: 6 }, () => `<p>${words(100)}</p>`).join('')
    const findings = await run(answerStructureCheck, { html: page(body) })
    const heading = findings.find((f) => f.title.includes('no subheadings'))
    expect(heading?.severity).toBe('low')
  })

  it('accepts a long page that is divided into sections', async () => {
    const body = Array.from({ length: 6 }, (_, i) => `<h2>Section ${i}</h2><p>${words(100)}</p>`).join('')
    expect(await run(answerStructureCheck, { html: page(body) })).toEqual([])
  })

  it('flags a single oversized paragraph', async () => {
    const body = `<h2>One</h2><p>${words(400)}</p>`
    const findings = await run(answerStructureCheck, { html: page(body) })
    expect(findings.find((f) => f.title.includes('single paragraph'))?.severity).toBe('info')
  })
})

describe('aeo.faq-howto-schema', () => {
  const questions = Array.from({ length: 4 }, (_, i) => `<h3>How does thing ${i} work?</h3><p>It does.</p>`).join('')

  it('does not ask an ordinary page to invent a FAQ', async () => {
    // The calibration that makes this check worth shipping: fabricated Q&A to
    // satisfy a scanner helps nobody and violates Google's guidelines.
    const body = Array.from({ length: 5 }, (_, i) => `<h2>Feature ${i}</h2><p>${words(50)}</p>`).join('')
    expect(await run(faqHowToSchemaCheck, { html: page(body) })).toEqual([])
  })

  it('stays silent below the question threshold', async () => {
    expect(await run(faqHowToSchemaCheck, { html: page('<h3>Why?</h3><p>Because.</p>') })).toEqual([])
  })

  it('flags real question-and-answer content with no schema', async () => {
    const findings = await run(faqHowToSchemaCheck, { html: page(questions) })
    expect(only(findings).severity).toBe('info')
    expect((only(findings).evidence?.questionHeadings as string[]).length).toBe(4)
  })

  it('recognises an accordion built from <details>', async () => {
    const body = Array.from({ length: 3 }, (_, i) => `<details><summary>Q${i}?</summary><p>A</p></details>`).join('')
    expect(await run(faqHowToSchemaCheck, { html: page(body) })).toHaveLength(1)
  })

  it('accepts a page that already declares FAQPage', async () => {
    const head = ld({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [] })
    expect(await run(faqHowToSchemaCheck, { html: page(questions, head) })).toEqual([])
  })
})

describe('aeo.author-date', () => {
  const article = { '@context': 'https://schema.org', '@type': 'Article', headline: 'x' }

  it('says nothing on a page that is not an article', async () => {
    expect(await run(authorDateCheck, { html: page(`<p>${words(300)}</p>`) })).toEqual([])
  })

  it('flags a bare article for both author and date', async () => {
    const findings = await run(authorDateCheck, { html: page('<article><p>hi</p></article>') })
    expect(findings.map((f) => f.title).sort()).toEqual([
      'Article carries no publication date',
      'Article has no attributable author',
    ])
  })

  it('accepts author and date from JSON-LD', async () => {
    const head = ld({ ...article, author: { '@type': 'Person', name: 'A' }, datePublished: '2026-01-01' })
    expect(await run(authorDateCheck, { html: page('<p>hi</p>', head) })).toEqual([])
  })

  it('accepts a meta author and a <time datetime>', async () => {
    const html = page('<article><time datetime="2026-01-01">Jan</time></article>', '<meta name="author" content="A" />')
    expect(await run(authorDateCheck, { html })).toEqual([])
  })

  it('treats og:type=article as an article', async () => {
    const html = page('<p>hi</p>', '<meta property="og:type" content="article" />')
    expect(await run(authorDateCheck, { html })).toHaveLength(2)
  })
})

describe('aeo.outbound-citations', () => {
  const longArticle = (links = '') =>
    page(`<article><p>${words(700)}</p>${links}</article>`)

  it('says nothing on a page that is not an article', async () => {
    expect(await run(outboundCitationsCheck, { html: page(`<p>${words(700)}</p>`) })).toEqual([])
  })

  it('says nothing on a short article', async () => {
    expect(await run(outboundCitationsCheck, { html: page(`<article><p>${words(100)}</p></article>`) })).toEqual([])
  })

  it('flags a long article that cites nothing', async () => {
    expect(only(await run(outboundCitationsCheck, { html: longArticle() })).severity).toBe('info')
  })

  it('does not count internal links as citations', async () => {
    const html = longArticle('<a href="/other">internal</a><a href="https://site.test/x">also internal</a>')
    expect(await run(outboundCitationsCheck, { html })).toHaveLength(1)
  })

  it('accepts a single genuine outbound link', async () => {
    // The check asks whether the page cites anything, never for more citations.
    const html = longArticle('<a href="https://rfc-editor.org/rfc/rfc9309">the spec</a>')
    expect(await run(outboundCitationsCheck, { html })).toEqual([])
  })
})
