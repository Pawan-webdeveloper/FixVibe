/**
 * Is the content in the HTML, or does it only exist after JavaScript runs?
 *
 * This is the check the rest of the AEO pillar depends on. The crawlers behind
 * today's assistants — GPTBot, PerplexityBot, ClaudeBot, CCBot — fetch HTML and
 * do not execute JavaScript. A client-rendered page is not badly summarised by
 * them; it is invisible to them. Every other AEO improvement is moot until the
 * text is in the response.
 *
 * Precision matters more than reach, because "your site is invisible" is an
 * expensive thing to be wrong about. Three independent signals must all hold:
 * a known framework mount point, that mount point essentially empty, and
 * external scripts present to fill it later. A page that is simply short — a
 * link page, a holding page — trips none of them.
 */

import type { Check, Finding } from '../types.ts'
import { visibleText, wordCount } from './content.ts'

const ID = 'aeo.ssr-content'

/** The default mount points of the frameworks that ship a blank shell. */
const MOUNT_POINTS = ['#root', '#__next', '#app', '#___gatsby', '#svelte', '[data-reactroot]']

/** Below this the page has no prose worth extracting, whatever else is on it. */
const MIN_WORDS = 40

export const ssrContentCheck: Check = {
  id: ID,
  category: 'aeo',
  title: 'Server-rendered content',

  run(ctx) {
    const text = visibleText(ctx)
    const words = wordCount(text)
    if (words >= MIN_WORDS) return []

    const mount = MOUNT_POINTS.find((selector) => ctx.$(selector).length > 0)
    if (!mount) return [] // no shell to speak of; a short page is just short

    const externalScripts = ctx.scripts.filter((script) => script.url).length
    if (externalScripts === 0) return [] // nothing is going to arrive later either

    return [
      {
        checkId: ID,
        category: 'aeo',
        severity: 'high',
        title: 'Page content is rendered by JavaScript, not sent in the HTML',
        description:
          `The HTML response carries ${words} words of text and an empty ${mount} mount point, with ` +
          `${externalScripts} script${externalScripts === 1 ? '' : 's'} to fill it in the browser. ` +
          'The crawlers behind AI assistants fetch HTML and do not run JavaScript, so what they ' +
          'receive for this page is a blank shell — it cannot be quoted, summarised or cited, and no ' +
          'other change on this page matters until the text is in the response itself.',
        evidence: { visibleWords: words, mountPoint: mount, externalScripts, sample: text.slice(0, 160) },
        remediation:
          'Server-render or statically generate the page content so the HTML response already contains it.',
        fixPrompt:
          'This page ships an empty mount point and renders its content in the browser, which means ' +
          'crawlers that do not execute JavaScript receive nothing. Move it to server rendering or ' +
          'static generation so the HTML response contains the real text — in Next.js that means a ' +
          'Server Component or generateStaticParams rather than a client component fetching on mount; ' +
          'in Vite/CRA it means adding SSR or prerendering. Verify with ' +
          '`curl -s <url> | grep "<some sentence from the page>"`: if the sentence is not in the ' +
          'output, no crawler can read it either.',
      } satisfies Finding,
    ]
  },
}
