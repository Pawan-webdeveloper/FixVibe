/**
 * Unit tests for the performance, accessibility and compliance checks, plus
 * the three SEO ones that landed with them.
 *
 * The theme running through these pillars is that the obvious version of each
 * check is wrong in a way that fires on healthy sites: alt="" is correct and
 * must not be reported, a short max-age on an unhashed asset is correct, a site
 * with no trackers needs no cookie banner, and a monolingual site needs no
 * hreflang. Most of what follows pins those.
 */

import { describe, expect, it } from 'vitest'
import type { Check, Finding } from '../src/types.ts'
import { formLabelsCheck } from '../src/accessibility/static/form-labels.ts'
import { imgAltCheck } from '../src/accessibility/static/img-alt.ts'
import { linkTextCheck } from '../src/accessibility/static/link-text.ts'
import { cookieBannerCheck } from '../src/compliance/cookie-banner.ts'
import { privacyPolicyLinkCheck } from '../src/compliance/privacy-policy-link.ts'
import { trackersBeforeConsentCheck } from '../src/compliance/trackers-before-consent.ts'
import { cachingHeadersCheck } from '../src/performance/caching-headers.ts'
import { compressionCheck } from '../src/performance/compression.ts'
import { imageFormatsCheck } from '../src/performance/image-formats.ts'
import { faviconCheck } from '../src/seo/favicon.ts'
import { headingOrderCheck } from '../src/seo/heading-order.ts'
import { hreflangCheck } from '../src/seo/hreflang.ts'
import { makeContext, probeStub, type ContextOverrides } from './helpers.ts'

const run = async (check: Check, overrides: ContextOverrides = {}): Promise<Finding[]> =>
  check.run(makeContext(overrides))

const only = (findings: Finding[]): Finding => {
  expect(findings).toHaveLength(1)
  return findings[0]!
}

const page = (body: string, head = ''): string =>
  `<!doctype html><html lang="en"><head><title>t</title>${head}</head><body>${body}</body></html>`

const bulky = (body: string) => page(`${body}<p>${'filler text '.repeat(300)}</p>`)

// ---------------------------------------------------------------------------

describe('performance.compression', () => {
  it('accepts a compressed response', async () => {
    const findings = await run(compressionCheck, {
      headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' },
      html: bulky(''),
    })
    expect(findings).toEqual([])
  })

  it('flags a large uncompressed HTML response', async () => {
    const finding = only(await run(compressionCheck, { headers: { 'content-type': 'text/html' }, html: bulky('') }))
    expect(finding.severity).toBe('low')
    expect(finding.evidence).toMatchObject({ contentEncoding: null })
  })

  it('leaves a small response alone — framing costs more than it saves', async () => {
    expect(await run(compressionCheck, { headers: { 'content-type': 'text/html' }, html: '<p>hi</p>' })).toEqual([])
  })

  it('says nothing about a non-text response', async () => {
    expect(await run(compressionCheck, { headers: { 'content-type': 'image/png' }, html: bulky('') })).toEqual([])
  })

  it('treats identity as uncompressed, because it is', async () => {
    const headers = { 'content-type': 'text/html', 'content-encoding': 'identity' }
    expect(await run(compressionCheck, { headers, html: bulky('') })).toHaveLength(1)
  })
})

describe('performance.caching-headers', () => {
  const hashed = page('<script src="/assets/app-a3f9c2e1b8.js"></script>')

  it('says nothing when no asset carries a content hash', async () => {
    // A short max-age on /style.css is CORRECT — that URL's contents change.
    const html = page('<script src="/app.js"></script><link rel="stylesheet" href="/style.css">')
    expect(await run(cachingHeadersCheck, { html, probe: probeStub({}) })).toEqual([])
  })

  it('accepts a fingerprinted asset cached for a year', async () => {
    const probe = probeStub({
      '/assets/app-a3f9c2e1b8.js': { status: 200, headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    })
    expect(await run(cachingHeadersCheck, { html: hashed, probe })).toEqual([])
  })

  it('flags a fingerprinted asset with a short max-age', async () => {
    const probe = probeStub({
      '/assets/app-a3f9c2e1b8.js': { status: 200, headers: { 'cache-control': 'public, max-age=300' } },
    })
    expect(only(await run(cachingHeadersCheck, { html: hashed, probe })).evidence).toMatchObject({ maxAge: 300 })
  })

  it('flags a fingerprinted asset with no Cache-Control at all', async () => {
    const probe = probeStub({ '/assets/app-a3f9c2e1b8.js': { status: 200 } })
    expect(only(await run(cachingHeadersCheck, { html: hashed, probe })).evidence).toMatchObject({ cacheControl: null })
  })

  it('says nothing when the asset could not be reached', async () => {
    expect(await run(cachingHeadersCheck, { html: hashed, probe: probeStub({}) })).toEqual([])
  })
})

describe('performance.image-formats', () => {
  const legacy = (n: number) => Array.from({ length: n }, (_, i) => `<img src="/p${i}.jpg">`).join('')

  it('leaves a page with a couple of images alone', async () => {
    expect(await run(imageFormatsCheck, { html: page(legacy(2)) })).toEqual([])
  })

  it('flags a page carrying several legacy images', async () => {
    expect(only(await run(imageFormatsCheck, { html: page(legacy(6)) })).severity).toBe('info')
  })

  it('does not count an image that already offers a modern format', async () => {
    const html = page(
      Array.from(
        { length: 6 },
        (_, i) => `<picture><source type="image/avif" srcset="/p${i}.avif"><img src="/p${i}.jpg"></picture>`,
      ).join(''),
    )
    expect(await run(imageFormatsCheck, { html })).toEqual([])
  })

  it('accepts a webp offered through srcset', async () => {
    const html = page(Array.from({ length: 6 }, (_, i) => `<img src="/p${i}.png" srcset="/p${i}.webp 2x">`).join(''))
    expect(await run(imageFormatsCheck, { html })).toEqual([])
  })
})

describe('seo.favicon', () => {
  it('accepts a declared icon', async () => {
    const html = page('', '<link rel="icon" href="/icon.svg">')
    expect(await run(faviconCheck, { html, probe: probeStub({}) })).toEqual([])
  })

  it('accepts the two-token "shortcut icon" spelling', async () => {
    const html = page('', '<link rel="shortcut icon" href="/f.ico">')
    expect(await run(faviconCheck, { html, probe: probeStub({}) })).toEqual([])
  })

  it('accepts an undeclared favicon.ico, which browsers find anyway', async () => {
    const probe = probeStub({ '/favicon.ico': { status: 200 } })
    expect(await run(faviconCheck, { html: page(''), probe })).toEqual([])
  })

  it('flags no icon in markup and none at the conventional path', async () => {
    const probe = probeStub({ '/favicon.ico': { status: 404 } })
    expect(only(await run(faviconCheck, { html: page(''), probe })).severity).toBe('info')
  })

  it('says nothing when the probe could not answer', async () => {
    expect(await run(faviconCheck, { html: page(''), probe: probeStub({}) })).toEqual([])
  })
})

describe('seo.heading-order', () => {
  it('accepts a well-formed outline', async () => {
    const html = page('<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2>')
    expect(await run(headingOrderCheck, { html })).toEqual([])
  })

  it('accepts going back up several levels — that is a new section', async () => {
    expect(await run(headingOrderCheck, { html: page('<h1>A</h1><h2>B</h2><h4>C</h4><h1>D</h1>') })).toHaveLength(1)
  })

  it('flags a skipped level', async () => {
    const finding = only(await run(headingOrderCheck, { html: page('<h1>A</h1><h3>B</h3>') }))
    expect(finding.severity).toBe('low')
    expect(finding.evidence).toMatchObject({ outline: 'h1 h3' })
  })

  it('reports one finding for a page with the same habit throughout', async () => {
    const html = page('<h1>A</h1><h3>B</h3><h1>C</h1><h3>D</h3><h1>E</h1><h3>F</h3>')
    expect((only(await run(headingOrderCheck, { html })).evidence?.skips as string[]).length).toBe(3)
  })

  it('says nothing about a page with a single heading', async () => {
    expect(await run(headingOrderCheck, { html: page('<h1>Only</h1>') })).toEqual([])
  })
})

describe('seo.hreflang', () => {
  it('says nothing on a monolingual site', async () => {
    // Most sites. Asking them for hreflang would be noise on every scan.
    expect(await run(hreflangCheck, { html: page('') })).toEqual([])
  })

  it('accepts a correct, self-referencing set', async () => {
    const head =
      '<link rel="alternate" hreflang="en" href="https://site.test/">' +
      '<link rel="alternate" hreflang="fr" href="https://site.test/fr">' +
      '<link rel="alternate" hreflang="x-default" href="https://site.test/">'
    expect(await run(hreflangCheck, { html: page('', head) })).toEqual([])
  })

  it('flags a malformed language tag', async () => {
    const head =
      '<link rel="alternate" hreflang="en_GB" href="https://site.test/">' +
      '<link rel="alternate" hreflang="en" href="https://site.test/">'
    expect(
      (await run(hreflangCheck, { html: page('', head) })).some((f) => f.title.includes('not valid language')),
    ).toBe(true)
  })

  it('flags relative alternate URLs', async () => {
    const head = '<link rel="alternate" hreflang="fr" href="/fr">'
    expect((await run(hreflangCheck, { html: page('', head) })).some((f) => f.title.includes('absolute'))).toBe(true)
  })

  it('flags a set that does not include the page it is on', async () => {
    const head = '<link rel="alternate" hreflang="fr" href="https://site.test/fr">'
    expect((await run(hreflangCheck, { html: page('', head) })).some((f) => f.title.includes('does not include'))).toBe(
      true,
    )
  })
})

describe('accessibility.img-alt', () => {
  it('accepts alt="" — that is how a decorative image is declared', async () => {
    // The calibration that matters. Demanding text here makes pages worse.
    expect(await run(imgAltCheck, { html: page('<img src="/spacer.gif" alt="">') })).toEqual([])
  })

  it('accepts descriptive alt text', async () => {
    expect(await run(imgAltCheck, { html: page('<img src="/chart.png" alt="Revenue by quarter">') })).toEqual([])
  })

  it('flags an image with no alt attribute at all', async () => {
    const finding = only(await run(imgAltCheck, { html: page('<img src="/photo.jpg">') }))
    expect(finding.severity).toBe('medium')
  })

  it('accepts an image named by aria-label or marked presentational', async () => {
    const html = page('<img src="/a.png" aria-label="Logo"><img src="/b.png" role="presentation">')
    expect(await run(imgAltCheck, { html })).toEqual([])
  })
})

describe('accessibility.form-labels', () => {
  it('accepts a label bound by for=', async () => {
    expect(await run(formLabelsCheck, { html: page('<label for="e">Email</label><input id="e">') })).toEqual([])
  })

  it('accepts an input nested inside its label', async () => {
    expect(await run(formLabelsCheck, { html: page('<label>Email <input name="e"></label>') })).toEqual([])
  })

  it('accepts aria-label where a visible label does not fit', async () => {
    expect(await run(formLabelsCheck, { html: page('<input name="q" aria-label="Search">') })).toEqual([])
  })

  it('does NOT accept a placeholder as a label', async () => {
    // It disappears on the first keystroke, which is when it is most needed.
    const finding = only(await run(formLabelsCheck, { html: page('<input name="email" placeholder="Email">') }))
    expect(finding.severity).toBe('medium')
    expect(finding.evidence).toMatchObject({ fields: ['email'] })
  })

  it('ignores controls that name themselves', async () => {
    const html = page('<input type="hidden" name="csrf"><input type="submit" value="Send"><button>Go</button>')
    expect(await run(formLabelsCheck, { html })).toEqual([])
  })

  it('covers select and textarea too', async () => {
    const html = page('<select name="country"></select><textarea name="notes"></textarea>')
    expect((only(await run(formLabelsCheck, { html })).evidence?.fields as string[]).length).toBe(2)
  })
})

describe('accessibility.link-text', () => {
  it('accepts a link that names its destination', async () => {
    expect(await run(linkTextCheck, { html: page('<a href="/pricing">See pricing</a>') })).toEqual([])
  })

  it('flags a link with no accessible name', async () => {
    const finding = only(await run(linkTextCheck, { html: page('<a href="/x"><svg></svg></a>') }))
    expect(finding.severity).toBe('medium')
  })

  it('accepts an icon link labelled by its image alt', async () => {
    expect(await run(linkTextCheck, { html: page('<a href="/x"><img src="/gh.svg" alt="GitHub"></a>') })).toEqual([])
  })

  it('accepts an icon link labelled by aria-label', async () => {
    expect(await run(linkTextCheck, { html: page('<a href="/x" aria-label="GitHub"><svg></svg></a>') })).toEqual([])
  })

  it('flags placeholder phrasing that says nothing in a link list', async () => {
    const html = page('<a href="/a">Read more</a><a href="/b">Click here</a>')
    const finding = only(await run(linkTextCheck, { html }))
    expect(finding.severity).toBe('low')
    expect(finding.evidence).toMatchObject({ total: 2 })
  })

  it('ignores trailing punctuation when matching a phrase', async () => {
    expect(await run(linkTextCheck, { html: page('<a href="/a">Read more →</a>') })).toHaveLength(1)
  })

  it('does not mistake a product name for filler', async () => {
    // Caught on stripe.com: "Link" is one of their products, and the check
    // reported the brand as placeholder text.
    expect(await run(linkTextCheck, { html: page('<a href="/payments/link">Link</a>') })).toEqual([])
  })

  it('leaves "Continue" alone — it is the correct label for a next step', async () => {
    expect(await run(linkTextCheck, { html: page('<a href="/checkout/2">Continue</a>') })).toEqual([])
  })
})

describe('compliance.trackers-before-consent', () => {
  const withTracker = (overrides: ContextOverrides = {}) => {
    const ctx = makeContext(overrides)
    ctx.scripts.push({ url: 'https://www.google-analytics.com/analytics.js', content: '' })
    return ctx
  }

  it('says nothing on a page with no trackers', async () => {
    expect(await run(trackersBeforeConsentCheck)).toEqual([])
  })

  it('reports a tracker loaded on the first response', async () => {
    const finding = only(await trackersBeforeConsentCheck.run(withTracker()))
    expect(finding.severity).toBe('low')
    expect(finding.evidence).toMatchObject({ services: ['Google Analytics'] })
  })

  it('escalates when a tracking cookie was already stored', async () => {
    // A cookie is the completed act; a script is only the setup for it.
    const ctx = withTracker({ headers: { 'set-cookie': '_ga=GA1.2.123; Path=/' } })
    const finding = only(await trackersBeforeConsentCheck.run(ctx))
    expect(finding.severity).toBe('medium')
    expect(finding.evidence).toMatchObject({ cookiesSet: ['_ga'] })
  })

  it('ignores cookies that are not tracking cookies', async () => {
    expect(await run(trackersBeforeConsentCheck, { headers: { 'set-cookie': 'session=abc; Path=/' } })).toEqual([])
  })
})

describe('compliance.cookie-banner', () => {
  const withTracker = (html?: string) => {
    const ctx = makeContext(html ? { html } : {})
    ctx.scripts.push({ url: 'https://www.googletagmanager.com/gtm.js', content: '' })
    return ctx
  }

  it('says nothing when there is nothing to consent to', async () => {
    // A site with no tracking needs no banner, and telling it otherwise would
    // be advising a worse experience for no legal benefit.
    expect(await run(cookieBannerCheck)).toEqual([])
  })

  it('accepts a recognised consent platform', async () => {
    const ctx = withTracker()
    ctx.scripts.push({ url: 'https://cdn.cookielaw.org/otSDKStub.js', content: '' })
    expect(await cookieBannerCheck.run(ctx)).toEqual([])
  })

  it('accepts a hand-rolled banner that names itself in its markup', async () => {
    expect(await cookieBannerCheck.run(withTracker(page('<div class="cookie-consent-bar">…</div>')))).toEqual([])
  })

  it('reports tracking with no consent UI found, at info because the HTML may not show it', async () => {
    const finding = only(await cookieBannerCheck.run(withTracker()))
    expect(finding.severity).toBe('info')
  })

  it('does not match the phrase "cookie policy" in ordinary footer text', async () => {
    const findings = await cookieBannerCheck.run(withTracker(page('<footer>Read our cookie policy</footer>')))
    expect(findings).toHaveLength(1)
  })
})

describe('compliance.privacy-policy-link', () => {
  const links = (extra = '') =>
    page(`<a href="/a">A</a><a href="/b">B</a><a href="/c">C</a>${extra}`)

  it('accepts a link found by its URL', async () => {
    expect(await run(privacyPolicyLinkCheck, { html: links('<a href="/legal/privacy">Legal</a>') })).toEqual([])
  })

  it('accepts a link found by its wording', async () => {
    expect(await run(privacyPolicyLinkCheck, { html: links('<a href="/l/p1">Privacy Policy</a>') })).toEqual([])
  })

  it('flags a site with links but none to a policy', async () => {
    expect(only(await run(privacyPolicyLinkCheck, { html: links() })).severity).toBe('low')
  })

  it('says nothing on a page that is barely a page', async () => {
    expect(await run(privacyPolicyLinkCheck, { html: page('<a href="/a">A</a>') })).toEqual([])
  })
})
