/**
 * axe-core against the rendered page.
 *
 * The engine's three static accessibility checks read the served HTML with a
 * parser. That catches the obvious cases and misses everything that depends on
 * what the browser computed: an implicit ARIA role, a label associated by
 * `aria-labelledby` across the document, a contrast ratio, an element that only
 * exists after hydration. axe answers those, because it runs inside the page
 * with a real accessibility tree in front of it.
 *
 * When this runs, the static checks stand down — see the engine's
 * accessibility/static/*.ts. Two sources reporting the same missing alt text
 * would charge the site twice for one defect.
 *
 * ## What is returned, and what is not
 *
 * Violations are summarised per RULE, not per node. A page with 200 unlabelled
 * icons has one problem, not two hundred findings, and the count carries the
 * scale. Up to three element snippets per rule are kept as evidence; the rest
 * are counted. Those snippets are markup from a public page, so there is no
 * customer data question here — but they are still capped, because a finding
 * containing 200 DOM fragments is not a finding anyone reads.
 *
 * `incomplete` results are deliberately dropped. axe reports those when it
 * cannot decide — most often colour contrast over a background image — and
 * "axe was unsure" is not something to put in front of a customer as a defect.
 *
 * ## Content-Security-Policy, and why this does not use addScriptTag
 *
 * The obvious way to get axe into a page is `page.addScriptTag`, which
 * appends a <script> element. That element is subject to the page's own CSP,
 * so on any site with a strict `script-src` — no 'unsafe-inline', no nonce we
 * could know — the browser refuses to run it and the audit dies. stripe.com
 * fails exactly this way.
 *
 * The consequence would have been perverse: the sites that score best on our
 * security checks are precisely the ones we could not audit for accessibility.
 *
 * `page.evaluate` is evaluated through the DevTools protocol rather than as a
 * document script, and CSP does not apply to it. So axe is evaluated, not
 * injected. The alternative — launching the context with `bypassCSP: true` —
 * would work too and is worse: it disables the page's protections for the
 * whole render, changing the behaviour of the thing we are measuring.
 */

// axe-core is CommonJS and has no real named exports at runtime, whatever its
// type declarations suggest — a named import parses and then fails to
// instantiate. Default import, then reach for `.source`.
import axeCore from 'axe-core'
import type { Page } from 'playwright-core'

/** WCAG 2.2 A and AA. AAA is a defensible goal and not a defect. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const MAX_SAMPLES_PER_RULE = 3
const MAX_SNIPPET_CHARS = 300

export interface AxeViolation {
  /** Stable axe rule id, e.g. "color-contrast". Used as the finding's key. */
  id: string
  impact: 'critical' | 'serious' | 'moderate' | 'minor' | null
  help: string
  helpUrl: string
  description: string
  /** WCAG success criteria this rule maps to, for the ones that carry them. */
  tags: string[]
  /** How many elements failed. The scale of the problem, not a list. */
  nodeCount: number
  /** Up to three failing elements, as CSS selector plus a truncated snippet. */
  samples: Array<{ target: string; html: string }>
}

export interface AxeSummary {
  violations: AxeViolation[]
  /** Rules that passed. Context for "we audited properly and found three things". */
  passCount: number
}

interface RawResults {
  violations?: Array<{
    id?: unknown
    impact?: unknown
    help?: unknown
    helpUrl?: unknown
    description?: unknown
    tags?: unknown
    nodes?: Array<{ target?: unknown; html?: unknown }>
  }>
  passes?: unknown[]
}

export async function axeAudit(page: Page): Promise<AxeSummary> {
  // Evaluated, not injected: a <script> tag is subject to the page's CSP and a
  // strict one blocks it outright. Evaluation goes through the DevTools
  // protocol, which CSP does not govern. axe still runs in the page's own
  // realm, which is what it needs to read the accessibility tree.
  await page.evaluate(axeCore.source)

  const raw = (await page.evaluate(
    ([tags]) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).axe.run(document, {
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations'], // skips assembling node lists we discard
      }),
    [TAGS] as const,
  )) as RawResults

  return {
    violations: (raw.violations ?? []).map(summarize).filter((violation) => violation.id !== ''),
    passCount: Array.isArray(raw.passes) ? raw.passes.length : 0,
  }
}

function summarize(violation: NonNullable<RawResults['violations']>[number]): AxeViolation {
  const nodes = Array.isArray(violation.nodes) ? violation.nodes : []

  return {
    id: text(violation.id),
    impact: impactOf(violation.impact),
    help: text(violation.help),
    helpUrl: text(violation.helpUrl),
    description: text(violation.description),
    tags: Array.isArray(violation.tags) ? violation.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    nodeCount: nodes.length,
    samples: nodes.slice(0, MAX_SAMPLES_PER_RULE).map((node) => ({
      // target is an array of selectors, one per frame depth.
      target: Array.isArray(node.target) ? node.target.map(String).join(' ') : text(node.target),
      html: truncate(text(node.html)),
    })),
  }
}

const IMPACTS = new Set(['critical', 'serious', 'moderate', 'minor'])

function impactOf(value: unknown): AxeViolation['impact'] {
  return typeof value === 'string' && IMPACTS.has(value) ? (value as AxeViolation['impact']) : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function truncate(value: string): string {
  return value.length > MAX_SNIPPET_CHARS ? `${value.slice(0, MAX_SNIPPET_CHARS)}…` : value
}
