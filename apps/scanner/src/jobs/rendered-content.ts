/**
 * The DOM after JavaScript has run.
 *
 * The engine's own fetch sees what the server sent. For a client-rendered app
 * that is often an empty div, which is exactly what `aeo.ssr-content` reports
 * on — but once that finding exists, every other markup check is auditing a
 * shell rather than the page a person sees. This job supplies the other half.
 *
 * Serialised through `documentElement.outerHTML`, so what comes back is the
 * live DOM as the browser understands it: framework output, hydrated content,
 * elements moved by script. It will not match the source byte for byte, and it
 * is not supposed to.
 */

import type { Page } from 'playwright-core'

/** Matches the engine's own page cap, so one side cannot silently see more. */
const MAX_HTML_BYTES = 5 * 1024 * 1024

export interface RenderedContent {
  html: string
  /** Where the browser ended up, which redirects and client-side routing can change. */
  finalUrl: string
  title: string
  truncated: boolean
}

export async function renderedContent(page: Page): Promise<RenderedContent> {
  const [html, title] = await Promise.all([
    page.evaluate(() => document.documentElement.outerHTML),
    page.title(),
  ])

  const truncated = html.length > MAX_HTML_BYTES
  return {
    html: truncated ? html.slice(0, MAX_HTML_BYTES) : html,
    finalUrl: page.url(),
    title,
    truncated,
  }
}
