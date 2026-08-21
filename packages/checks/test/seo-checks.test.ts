/**
 * Unit tests for the twelve SEO checks, on synthetic contexts.
 *
 * Beyond the usual missing / broken / correct triple, each block pins the
 * anti-noise decisions the checks make deliberately — a legitimate www→apex
 * canonical staying silent, three noindex sources collapsing into one finding,
 * a missing twitter:card not being reported twice. Those are the rules a future
 * refactor is most likely to undo without noticing.
 */

import { describe, expect, it } from 'vitest'
import type { Check, Finding } from '../src/types.ts'
import { canonicalCheck } from '../src/seo/canonical.ts'
import { h1Check } from '../src/seo/h1.ts'
import { langCheck } from '../src/seo/lang.ts'
import { metaDescriptionCheck } from '../src/seo/meta-description.ts'
import { openGraphCheck } from '../src/seo/open-graph.ts'
import { robotsMetaCheck } from '../src/seo/robots-meta.ts'
import { robotsTxtCheck } from '../src/seo/robots-txt.ts'
import { sitemapCheck } from '../src/seo/sitemap.ts'
import { structuredDataCheck } from '../src/seo/structured-data.ts'
import { titleCheck } from '../src/seo/title.ts'
import { twitterCardCheck } from '../src/seo/twitter-card.ts'
import { viewportCheck } from '../src/seo/viewport.ts'
import {
  makeContext,
  probeStub,
  robotsFrom,
  SITEMAP_XML,
  type ContextOverrides,
} from './helpers.ts'

const run = async (check: Check, overrides: ContextOverrides = {}): Promise<Finding[]> =>
  check.run(makeContext(overrides))

/** Wrap head markup in a document — keeps each case to the tag under test. */
const page = (head: string, body = '<h1>Heading</h1>'): string =>
  `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`

const only = (findings: Finding[]): Finding => {
  expect(findings).toHaveLength(1)
  return findings[0]!
}

// ---------------------------------------------------------------------------

describe('seo.title', () => {
  it('flags a missing title as high', async () => {
    const findings = await run(titleCheck, { html: page('') })
    expect(only(findings).severity).toBe('high')
  })

  it('ignores <title> inside inline SVG when counting page titles', async () => {
    const html = page(
      '<title>A perfectly reasonable page title for testing</title>',
      '<svg><title>Icon label</title></svg><h1>Heading</h1>',
    )
    expect(await run(titleCheck, { html })).toEqual([])
  })

  it('flags an empty title and skips the length rules', async () => {
    const findings = await run(titleCheck, { html: page('<title>   </title>') })
    expect(only(findings).title).toBe('Empty <title>')
  })

  it('flags duplicate titles with both values as evidence', async () => {
    const html = page('<title>First title that is long enough to pass</title><title>Second</title>')
    const findings = await run(titleCheck, { html })
    const duplicate = findings.find((f) => f.title.startsWith('Multiple'))!
    expect(duplicate.severity).toBe('low')
    expect(duplicate.evidence).toEqual({ titles: ['First title that is long enough to pass', 'Second'] })
  })

  it('flags an over-long title as low', async () => {
    const html = page(`<title>${'x'.repeat(80)}</title>`)
    expect(only(await run(titleCheck, { html })).severity).toBe('low')
  })

  it('flags a very short title as info only', async () => {
    expect(only(await run(titleCheck, { html: page('<title>Home</title>') })).severity).toBe('info')
  })

  it('counts astral characters once, as a reader does', async () => {
    // 58 ASCII + one emoji = 59 characters, but 60 UTF-16 code units.
    const html = page(`<title>${'x'.repeat(58)}😀</title>`)
    expect(await run(titleCheck, { html })).toEqual([])
  })
})

describe('seo.meta-description', () => {
  const good = 'A description that comfortably clears the fifty character minimum for a snippet.'

  it('flags a missing description as low', async () => {
    expect(only(await run(metaDescriptionCheck, { html: page('') })).severity).toBe('low')
  })

  it('matches the name attribute case-insensitively, as crawlers do', async () => {
    const html = page(`<meta name="Description" content="${good}" />`)
    expect(await run(metaDescriptionCheck, { html })).toEqual([])
  })

  it('flags duplicates', async () => {
    const html = page(`<meta name="description" content="${good}" /><meta name="description" content="${good}" />`)
    expect(only(await run(metaDescriptionCheck, { html })).title).toContain('Multiple')
  })

  it('flags an empty content attribute and skips the length rules', async () => {
    const html = page('<meta name="description" content="" />')
    expect(only(await run(metaDescriptionCheck, { html })).title).toBe('Empty meta description')
  })

  it('reports length problems as info, never as a ranking defect', async () => {
    const html = page(`<meta name="description" content="${'x'.repeat(200)}" />`)
    expect(only(await run(metaDescriptionCheck, { html })).severity).toBe('info')
  })
})

describe('seo.h1', () => {
  it('flags a page with no h1 as medium', async () => {
    expect(only(await run(h1Check, { html: page('', '<div>Headline</div>') })).severity).toBe('medium')
  })

  it('flags an h1 that renders no text', async () => {
    const findings = await run(h1Check, { html: page('', '<h1><img src="/logo.png" /></h1>') })
    expect(only(findings).title).toBe('H1 contains no text')
  })

  it('treats multiple h1s as info, not a defect', async () => {
    const findings = await run(h1Check, { html: page('', '<h1>One</h1><h1>Two</h1>') })
    expect(only(findings).severity).toBe('info')
    expect(only(findings).evidence).toEqual({ headings: ['One', 'Two'] })
  })

  it('accepts a single h1 with text', async () => {
    expect(await run(h1Check, { html: page('', '<h1>Heading</h1>') })).toEqual([])
  })
})

describe('seo.viewport', () => {
  it('flags a missing viewport as high', async () => {
    expect(only(await run(viewportCheck, { html: page('') })).severity).toBe('high')
  })

  it('flags a viewport that does not bind to the device width', async () => {
    const html = page('<meta name="viewport" content="width=1024" />')
    expect(only(await run(viewportCheck, { html })).title).toContain('device-width')
  })

  it('flags user-scalable=no as a low-severity accessibility problem', async () => {
    const html = page('<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no" />')
    const findings = await run(viewportCheck, { html })
    expect(only(findings).severity).toBe('low')
    expect(only(findings).title).toBe('Viewport blocks pinch-zoom')
  })

  it('flags maximum-scale=1.0 but accepts a generous maximum-scale', async () => {
    const blocked = page('<meta name="viewport" content="width=device-width, maximum-scale=1.0" />')
    expect(only(await run(viewportCheck, { html: blocked })).title).toBe('Viewport blocks pinch-zoom')

    const fine = page('<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />')
    expect(await run(viewportCheck, { html: fine })).toEqual([])
  })

  it('accepts the standard viewport', async () => {
    const html = page('<meta name="viewport" content="width=device-width, initial-scale=1" />')
    expect(await run(viewportCheck, { html })).toEqual([])
  })
})

describe('seo.canonical', () => {
  it('flags a missing canonical as low', async () => {
    expect(only(await run(canonicalCheck, { html: page('') })).severity).toBe('low')
  })

  it('stays silent on a deliberate www → apex canonical', async () => {
    const html = page('<link rel="canonical" href="https://example.com/" />')
    const findings = await run(canonicalCheck, { url: 'https://www.example.com/', html })
    expect(findings).toEqual([])
  })

  it('stays silent when the canonical is on a sub-domain of the same site', async () => {
    const html = page('<link rel="canonical" href="https://example.com/post" />')
    expect(await run(canonicalCheck, { url: 'https://blog.example.com/post', html })).toEqual([])
  })

  it('stays silent on a relative canonical pointing elsewhere on the same site', async () => {
    const html = page('<link rel="canonical" href="/other-page" />')
    expect(await run(canonicalCheck, { html })).toEqual([])
  })

  it('flags a canonical on an unrelated domain as medium', async () => {
    const html = page('<link rel="canonical" href="https://someone-else.example/page" />')
    const findings = await run(canonicalCheck, { html })
    expect(only(findings).severity).toBe('medium')
    expect(only(findings).title).toBe('Canonical points to a different site')
  })

  it('flags an http canonical on an https page', async () => {
    const html = page('<link rel="canonical" href="http://site.test/" />')
    const findings = await run(canonicalCheck, { html })
    expect(only(findings).title).toContain('insecure http://')
  })

  it('flags conflicting canonicals but not harmless duplicates', async () => {
    const conflicting = page(
      '<link rel="canonical" href="https://site.test/a" /><link rel="canonical" href="https://site.test/b" />',
    )
    expect(only(await run(canonicalCheck, { html: conflicting })).title).toContain('Conflicting')

    const identical = page(
      '<link rel="canonical" href="https://site.test/a" /><link rel="canonical" href="https://site.test/a" />',
    )
    expect(await run(canonicalCheck, { html: identical })).toEqual([])
  })

  it('flags an empty href', async () => {
    const html = page('<link rel="canonical" href="" />')
    expect(only(await run(canonicalCheck, { html })).title).toContain('empty href')
  })
})

describe('seo.lang', () => {
  it('flags a missing lang attribute', async () => {
    const html = '<!doctype html><html><head></head><body><h1>Hi</h1></body></html>'
    expect(only(await run(langCheck, { html })).severity).toBe('low')
  })

  it('flags an empty lang attribute', async () => {
    const html = '<!doctype html><html lang=""><head></head><body></body></html>'
    expect(only(await run(langCheck, { html })).title).toContain('Empty lang')
  })

  it('flags an underscore-separated tag as info', async () => {
    const html = '<!doctype html><html lang="en_US"><head></head><body></body></html>'
    expect(only(await run(langCheck, { html })).severity).toBe('info')
  })

  it.each(['en', 'en-US', 'hi-IN', 'es-419', 'zh-Hans-CN', 'pt-BR'])('accepts %s', async (lang) => {
    const html = `<!doctype html><html lang="${lang}"><head></head><body></body></html>`
    expect(await run(langCheck, { html })).toEqual([])
  })
})

describe('seo.robots-meta', () => {
  it('flags a noindex meta tag as critical', async () => {
    const html = page('<meta name="robots" content="noindex, follow" />')
    const findings = await run(robotsMetaCheck, { html })
    expect(only(findings).severity).toBe('critical')
  })

  it('treats content="none" as noindex', async () => {
    const html = page('<meta name="robots" content="none" />')
    expect(only(await run(robotsMetaCheck, { html })).severity).toBe('critical')
  })

  it('reads the X-Robots-Tag response header, which overrides the meta tag', async () => {
    const findings = await run(robotsMetaCheck, { headers: { 'x-robots-tag': 'noindex' } })
    expect(only(findings).severity).toBe('critical')
  })

  it('flags a googlebot-specific noindex', async () => {
    const html = page('<meta name="googlebot" content="noindex" />')
    expect(only(await run(robotsMetaCheck, { html })).severity).toBe('critical')
  })

  it('collapses several noindex sources into ONE finding, not one penalty each', async () => {
    const html = page('<meta name="robots" content="noindex" /><meta name="googlebot" content="noindex" />')
    const findings = await run(robotsMetaCheck, { html, headers: { 'x-robots-tag': 'noindex' } })
    expect(findings).toHaveLength(1)
    expect((findings[0]!.evidence!.sources as unknown[]).length).toBe(3)
  })

  it('reports nofollow on its own as info, and not alongside noindex', async () => {
    const nofollowOnly = page('<meta name="robots" content="nofollow" />')
    expect(only(await run(robotsMetaCheck, { html: nofollowOnly })).severity).toBe('info')

    const both = page('<meta name="robots" content="noindex, nofollow" />')
    expect(await run(robotsMetaCheck, { html: both })).toHaveLength(1)
  })

  it('stays silent on harmless robots directives', async () => {
    const html = page('<meta name="robots" content="index, follow, max-image-preview:large" />')
    expect(await run(robotsMetaCheck, { html })).toEqual([])
  })
})

describe('seo.open-graph', () => {
  const complete =
    '<meta property="og:title" content="Title" />' +
    '<meta property="og:description" content="Description" />' +
    '<meta property="og:image" content="https://site.test/og.png" />'

  it('reports a page with no OG tags once, not once per tag', async () => {
    const findings = await run(openGraphCheck, { html: page('') })
    expect(findings).toHaveLength(1)
    expect(only(findings).severity).toBe('low')
  })

  it('reports each missing tag when the page has partial OG metadata', async () => {
    const html = page('<meta property="og:title" content="Title" />')
    const findings = await run(openGraphCheck, { html })
    expect(findings.map((f) => f.title).sort()).toEqual(['Missing og:description', 'Missing og:image'])
    expect(findings.every((f) => f.severity === 'info')).toBe(true)
  })

  it('accepts the name= spelling of OG tags', async () => {
    const html = page(complete.replaceAll('property=', 'name='))
    expect(await run(openGraphCheck, { html })).toEqual([])
  })

  it('flags a relative og:image and shows the resolved URL', async () => {
    const html = page(complete.replace('https://site.test/og.png', '/og.png'))
    const findings = await run(openGraphCheck, { html })
    expect(only(findings).severity).toBe('low')
    expect(only(findings).evidence).toMatchObject({ resolved: 'https://site.test/og.png' })
  })

  it('accepts complete OG metadata', async () => {
    expect(await run(openGraphCheck, { html: page(complete) })).toEqual([])
  })
})

describe('seo.twitter-card', () => {
  it('stays silent when no twitter:card is present — OG covers that case', async () => {
    expect(await run(twitterCardCheck, { html: page('') })).toEqual([])
  })

  it('flags an unknown card type', async () => {
    const html = page('<meta name="twitter:card" content="big_picture" />')
    expect(only(await run(twitterCardCheck, { html })).severity).toBe('low')
  })

  it('flags an empty card value', async () => {
    const html = page('<meta name="twitter:card" content="" />')
    expect(only(await run(twitterCardCheck, { html })).title).toContain('empty value')
  })

  it('flags a large-image card with no image anywhere', async () => {
    const html = page('<meta name="twitter:card" content="summary_large_image" />')
    expect(only(await run(twitterCardCheck, { html })).title).toContain('no image')
  })

  it('accepts a large-image card backed by og:image alone', async () => {
    const html = page(
      '<meta name="twitter:card" content="summary_large_image" />' +
        '<meta property="og:image" content="https://site.test/og.png" />',
    )
    expect(await run(twitterCardCheck, { html })).toEqual([])
  })
})

describe('seo.structured-data', () => {
  const ld = (json: string) => page(`<script type="application/ld+json">${json}</script>`)

  it('reports the absence of JSON-LD as info', async () => {
    expect(only(await run(structuredDataCheck, { html: page('') })).severity).toBe('info')
  })

  it('flags a block that does not parse', async () => {
    const findings = await run(structuredDataCheck, { html: ld('{"@type": "WebSite",}') })
    expect(only(findings).severity).toBe('low')
    expect(only(findings).title).toContain('not valid JSON')
  })

  it('accepts a @graph container with no top-level @type', async () => {
    const html = ld('{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"x"}]}')
    expect(await run(structuredDataCheck, { html })).toEqual([])
  })

  it('accepts an array of typed nodes', async () => {
    const html = ld('[{"@context":"https://schema.org","@type":"WebSite"}]')
    expect(await run(structuredDataCheck, { html })).toEqual([])
  })

  it('flags a missing @context', async () => {
    const findings = await run(structuredDataCheck, { html: ld('{"@type":"WebSite"}') })
    expect(only(findings).title).toContain('@context')
  })

  it('flags a missing @type', async () => {
    const findings = await run(structuredDataCheck, { html: ld('{"@context":"https://schema.org"}') })
    expect(only(findings).title).toContain('@type')
  })

  it('reads a content type carrying a charset parameter', async () => {
    const html = page(
      '<script type="application/ld+json; charset=utf-8">{"@context":"https://schema.org","@type":"WebSite"}</script>',
    )
    expect(await run(structuredDataCheck, { html })).toEqual([])
  })
})

describe('seo.robots-txt', () => {
  it('flags a missing robots.txt as low', async () => {
    expect(only(await run(robotsTxtCheck, { robots: null })).severity).toBe('low')
  })

  it('flags a site-wide disallow once, as a Googlebot block', async () => {
    const findings = await run(robotsTxtCheck, { robots: robotsFrom('User-agent: *\nDisallow: /\n') })
    expect(only(findings).severity).toBe('critical')
    expect(only(findings).title).toContain('Googlebot')
  })

  it('flags "everyone but Googlebot" as medium, not critical', async () => {
    const raw = 'User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n'
    const findings = await run(robotsTxtCheck, { robots: robotsFrom(raw) })
    expect(only(findings).severity).toBe('medium')
  })

  it('flags an HTML body served at /robots.txt', async () => {
    const findings = await run(robotsTxtCheck, { robots: robotsFrom('<!doctype html><html><body>404</body></html>') })
    expect(only(findings).title).toContain('HTML')
  })

  it('accepts a permissive robots.txt', async () => {
    const raw = 'User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: https://site.test/sitemap.xml\n'
    expect(await run(robotsTxtCheck, { robots: robotsFrom(raw) })).toEqual([])
  })
})

describe('seo.sitemap', () => {
  it('flags a site with no declaration and nothing at /sitemap.xml', async () => {
    const findings = await run(sitemapCheck, { robots: null, probe: probeStub({}) })
    expect(only(findings).severity).toBe('low')
    expect(only(findings).evidence).toMatchObject({ probed: 'https://site.test/sitemap.xml' })
  })

  it('notes an undeclared sitemap that exists at the conventional path', async () => {
    const findings = await run(sitemapCheck, {
      robots: robotsFrom('User-agent: *\nAllow: /\n'),
      probe: probeStub({ '/sitemap.xml': { status: 200, body: SITEMAP_XML } }),
    })
    expect(only(findings).severity).toBe('info')
    expect(only(findings).title).toContain('not declared')
  })

  it('probes the DECLARED sitemap path, not the conventional one', async () => {
    const probed: string[] = []
    const findings = await run(sitemapCheck, {
      robots: robotsFrom('User-agent: *\nSitemap: https://site.test/sitemap-index.xml\n'),
      probe: (path) => {
        probed.push(path)
        return Promise.resolve({ status: 200, body: SITEMAP_XML, headers: new Headers() })
      },
    })
    expect(probed).toEqual(['/sitemap-index.xml'])
    expect(findings).toEqual([])
  })

  it('flags a declared sitemap that 404s', async () => {
    const findings = await run(sitemapCheck, {
      robots: robotsFrom('User-agent: *\nSitemap: https://site.test/sitemap.xml\n'),
      probe: probeStub({ '/sitemap.xml': { status: 404 } }),
    })
    expect(only(findings).severity).toBe('medium')
    expect(only(findings).title).toContain('404')
  })

  it('stays silent when the declared sitemap lives on another host we cannot probe', async () => {
    const findings = await run(sitemapCheck, {
      robots: robotsFrom('User-agent: *\nSitemap: https://cdn.example/sitemap.xml\n'),
      probe: probeStub({}),
    })
    expect(findings).toEqual([])
  })

  it('stays silent when a declared sitemap is simply unreachable this scan', async () => {
    const findings = await run(sitemapCheck, {
      robots: robotsFrom('User-agent: *\nSitemap: https://site.test/sitemap.xml\n'),
      probe: probeStub({}), // null = unknown, never "missing"
    })
    expect(findings).toEqual([])
  })

  it('flags a sitemap path that serves the app shell with a 200', async () => {
    const findings = await run(sitemapCheck, {
      robots: robotsFrom('User-agent: *\nSitemap: https://site.test/sitemap.xml\n'),
      probe: probeStub({ '/sitemap.xml': { status: 200, body: '<!doctype html><html><body>App</body></html>' } }),
    })
    expect(only(findings).title).toContain('HTML page')
  })

  it('does not guess about a 200 body it cannot read, such as a gzipped sitemap', async () => {
    const findings = await run(sitemapCheck, {
      robots: robotsFrom('User-agent: *\nSitemap: https://site.test/sitemap.xml.gz\n'),
      probe: probeStub({ '/sitemap.xml.gz': { status: 200, body: 'binary' } }),
    })
    expect(findings).toEqual([])
  })
})
