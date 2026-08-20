/**
 * One cheerio parse per scan — every check shares the resulting `$`.
 * Alongside the document we pre-extract the script list, because several
 * security checks (CSP quality, secrets-in-JS, SRI) reason about scripts and
 * should not each rediscover them.
 */

import * as cheerio from 'cheerio'
import type { CheerioAPI } from 'cheerio'

// Values of <script type> that actually execute as JavaScript. Anything else
// (ld+json, importmap, text/template, …) is data, not code.
const JS_SCRIPT_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript'])

export function parseHtml(
  html: string,
  baseUrl: URL,
): { $: CheerioAPI; scripts: Array<{ url: string; content: string }> } {
  const $ = cheerio.load(html)

  const scripts: Array<{ url: string; content: string }> = []
  $('script').each((_, element) => {
    const type = ($(element).attr('type') ?? '').trim().toLowerCase()
    if (!JS_SCRIPT_TYPES.has(type)) return

    const src = $(element).attr('src')
    if (src) {
      try {
        scripts.push({ url: new URL(src, baseUrl).href, content: '' })
      } catch {
        // Unresolvable src (e.g. "//" alone, template placeholders) — nothing to record.
      }
    } else {
      const content = $(element).text()
      if (content.trim()) scripts.push({ url: '', content })
    }
  })

  return { $, scripts }
}
