/**
 * Which scripts get read.
 *
 * This exists because the first version of the selection read ZERO bytes on
 * both stripe.com and github.com: it only accepted scripts on the page's own
 * registrable domain, and both serve their bundles from a separate asset
 * domain — stripecdn.com, githubassets.com — which is ordinary practice. The
 * checks downstream stayed silent and looked like they were passing.
 *
 * Only the selection is tested here. It is pure, it is where the bug was, and
 * the fetching around it is network.
 */

import { describe, expect, it } from 'vitest'
import { selectScripts } from '../src/context/fetch-scripts.ts'

const page = new URL('https://example.com/')
const script = (url: string) => ({ url, content: '' })

describe('selectScripts', () => {
  it('reads a bundle served from a separate asset domain', () => {
    // The regression that made this file necessary.
    expect(selectScripts([script('https://b.stripecdn.com/app.js')], new URL('https://stripe.com/'))).toEqual([
      'https://b.stripecdn.com/app.js',
    ])
  })

  it('skips vendor products, whose bundles cannot contain this site\'s secrets', () => {
    const scripts = [
      script('https://www.googletagmanager.com/gtm.js'),
      script('https://static.hotjar.com/c/hotjar.js'),
      script('https://example.com/app.js'),
    ]
    expect(selectScripts(scripts, page)).toEqual(['https://example.com/app.js'])
  })

  it('matches a vendor on its subdomains but not on a lookalike host', () => {
    const scripts = [
      script('https://cdn.segment.com/a.js'),
      script('https://notsegment.com/b.js'),
      script('https://segment.com.evil.test/c.js'),
    ]
    expect(selectScripts(scripts, page)).toEqual([
      'https://notsegment.com/b.js',
      'https://segment.com.evil.test/c.js',
    ])
  })

  it('spends a tight budget on the site\'s own files first', () => {
    const scripts = [
      script('https://unrelated.test/vendor.js'),
      script('https://assets.example.com/chunk.js'),
      script('https://example.com/main.js'),
    ]
    expect(selectScripts(scripts, page, 2)).toEqual([
      'https://example.com/main.js',
      'https://assets.example.com/chunk.js',
    ])
  })

  it('still reads unrelated hosts when there is budget left', () => {
    const scripts = [script('https://unrelated.test/a.js'), script('https://example.com/b.js')]
    expect(selectScripts(scripts, page)).toHaveLength(2)
  })

  it('is stable within a rank, so two scans of one site read the same files', () => {
    const scripts = ['a', 'b', 'c', 'd'].map((n) => script(`https://example.com/${n}.js`))
    expect(selectScripts(scripts, page, 2)).toEqual(['https://example.com/a.js', 'https://example.com/b.js'])
  })

  it('ignores inline scripts, which already carry their content', () => {
    expect(selectScripts([{ url: '', content: 'x=1' }], page)).toEqual([])
  })

  it('reads a repeated bundle once', () => {
    const scripts = [script('https://example.com/a.js'), script('https://example.com/a.js')]
    expect(selectScripts(scripts, page)).toEqual(['https://example.com/a.js'])
  })

  it('skips a src it cannot parse rather than throwing', () => {
    expect(selectScripts([script('::::not a url')], page)).toEqual([])
  })

  it('honours the budget', () => {
    const scripts = Array.from({ length: 20 }, (_, i) => script(`https://example.com/${i}.js`))
    expect(selectScripts(scripts, page)).toHaveLength(6)
  })
})
