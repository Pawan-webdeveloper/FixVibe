/**
 * Core Web Vitals — how long the page actually takes to become useful, and
 * whether it stays still and responds while a person is using it.
 *
 * These are the three metrics Google ranks on, and the only checks in this
 * engine that report a MEASUREMENT rather than an observation about
 * configuration. That makes the sourcing the most important thing about them:
 *
 *   Field data is the 75th percentile of what real Chrome users experienced.
 *     It is what Google actually uses, it accounts for the devices and
 *     networks this site's audience really has, and it exists only for URLs
 *     with enough traffic.
 *
 *   Lab data is one simulated load on a throttled mid-range phone in a data
 *     centre. It is reproducible and good for diagnosis, and it is routinely
 *     wrong about a specific audience — a site whose users are all on desktop
 *     fibre will look worse in the lab than they will ever experience.
 *
 * So field wins whenever it exists, lab is used only as a fallback, and a
 * finding built on lab data says so in its first sentence and carries a lower
 * severity. Reporting a simulated number as though it were a measurement of
 * this site's users would be the same class of mistake as reporting "no DKIM"
 * for a selector we never queried.
 *
 * One finding per failing metric, because each has a genuinely different
 * cause and a different fix: LCP is what takes the longest to paint, CLS is
 * layout moving under a reader's finger, INP is the main thread being too busy
 * to answer a tap.
 *
 * Thresholds are Google's published ones, unmodified. There is no value in
 * inventing our own — a customer who improves a metric wants the number that
 * moves in Search Console to be the number we showed them.
 */

import type { Check, CheckContext, Finding, PageSpeedSummary } from '../types.ts'

const ID = 'performance.core-web-vitals'

/** web.dev/vitals: "good" at or below the first, "poor" above the second. */
const THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },
  inp: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
  /** Lab stand-in for INP; there is no way to measure a real interaction in a synthetic load. */
  tbt: { good: 200, poor: 600 },
} as const

type Rating = 'good' | 'needs-improvement' | 'poor'

export const coreWebVitalsCheck: Check = {
  id: ID,
  category: 'performance',
  title: 'Core Web Vitals',

  run(ctx) {
    // Absent or null means we never measured: no API key, spent quota, or a
    // fast scan. Silence is the only honest output.
    const psi = ctx.pageSpeed
    if (!psi) return []

    return psi.field ? fromField(ctx, psi, psi.field) : fromLab(ctx, psi)
  },
}

function fromField(
  ctx: CheckContext,
  psi: PageSpeedSummary,
  field: NonNullable<PageSpeedSummary['field']>,
): Finding[] {
  // Origin-scoped data describes the whole site because this URL had too
  // little traffic of its own. Still real users, still worth reporting — but
  // the finding must not claim it measured this page.
  const subject =
    field.scope === 'url'
      ? 'Real Chrome users loading this page'
      : `Real Chrome users across ${ctx.finalUrl.hostname} (this URL alone has too little traffic to report on)`

  const findings: Finding[] = []

  const lcp = rate(field.lcpMs, THRESHOLDS.lcp)
  if (lcp && lcp !== 'good') {
    findings.push({
      checkId: ID,
      category: 'performance',
      severity: lcp === 'poor' ? 'high' : 'medium',
      title: `Largest Contentful Paint is ${formatMs(field.lcpMs)} for real users`,
      description:
        `${subject} wait ${formatMs(field.lcpMs)} at the 75th percentile before the largest thing on ` +
        `the screen finishes rendering — Google's threshold for "good" is 2.5 s and for "poor" is 4 s. ` +
        'This is the metric people describe as "the site is slow": until it lands there is nothing ' +
        'substantial to read. It is a confirmed ranking signal, and this figure is measured, not simulated.',
      evidence: evidence(psi, field, { metric: 'LCP', value: field.lcpMs, rating: lcp }),
      remediation:
        'Find which element is the LCP, then remove whatever delays it: server response time, a ' +
        'render-blocking stylesheet or font, or a hero image that is lazy-loaded or unoptimised.',
      fixPrompt:
        `Real users of ${ctx.finalUrl.href} see a Largest Contentful Paint of ${formatMs(field.lcpMs)} ` +
        `(75th percentile, mobile). Target is under 2.5 s.\n\n` +
        'Identify the LCP element first — run Lighthouse locally or open PageSpeed Insights for this ' +
        'URL and read "Largest Contentful Paint element". It is nearly always a hero image or the ' +
        'first block of text. Then, in this repository:\n\n' +
        '  - If it is an image: serve it in a modern format at the size it is displayed, give it ' +
        'explicit width/height, set `fetchpriority="high"`, and make sure it is NOT lazy-loaded ' +
        '(loading="lazy" on the LCP image is the single most common cause of this). Preload it if it ' +
        'is discovered late, e.g. from CSS.\n' +
        '  - If it is text: preload the font and set `font-display: swap` so it is not invisible while ' +
        'the font loads.\n' +
        '  - Remove render-blocking resources in <head>: inline the critical CSS, defer the rest, and ' +
        'add `defer` or `async` to scripts that are not needed for first paint.\n' +
        '  - If the server is slow to respond at all (check Time to First Byte), the fix is caching or ' +
        'the origin, not the markup.\n\n' +
        'Re-measure with field data after deploying — lab numbers will move before real ones do, and ' +
        'CrUX reports a trailing 28-day window, so the reported figure lags a fix by weeks.',
    })
  }

  const inp = rate(field.inpMs, THRESHOLDS.inp)
  if (inp && inp !== 'good') {
    findings.push({
      checkId: ID,
      category: 'performance',
      severity: inp === 'poor' ? 'high' : 'medium',
      title: `Interaction to Next Paint is ${formatMs(field.inpMs)} for real users`,
      description:
        `${subject} wait ${formatMs(field.inpMs)} at the 75th percentile between tapping something and ` +
        'seeing the page respond. Good is under 200 ms; past 500 ms an interface feels broken and ' +
        'people tap again, which makes it worse. INP measures the whole interaction — the event ' +
        'handler, the work it triggers, and the next paint — so it is almost always the main thread ' +
        'being occupied by JavaScript.',
      evidence: evidence(psi, field, { metric: 'INP', value: field.inpMs, rating: inp }),
      remediation:
        'Break up long tasks on the main thread and move work out of event handlers, so the browser ' +
        'can paint a response before finishing the work.',
      fixPrompt:
        `Real users of ${ctx.finalUrl.href} see an Interaction to Next Paint of ` +
        `${formatMs(field.inpMs)} (75th percentile, mobile). Target is under 200 ms.\n\n` +
        'Record a performance profile in Chrome DevTools while interacting with the page and find the ' +
        'long tasks (over 50 ms). Then, in this repository:\n\n' +
        '  - Split long-running work with `await scheduler.yield()` (or a `setTimeout(0)` fallback) so ' +
        'the browser can paint between chunks.\n' +
        '  - Do the visual response first and the expensive work after: update the UI state, yield, ' +
        'then run the computation or the network call.\n' +
        '  - Look for handlers doing layout-thrashing reads and writes in a loop, large synchronous ' +
        'JSON parsing, or re-rendering a whole list on every keystroke (debounce, virtualise, or ' +
        'memoise).\n' +
        '  - Cut the JavaScript that runs at startup: hydration of components that are not interactive ' +
        'is pure INP cost. Check whether large client components could be server components or could ' +
        'be loaded on interaction.',
    })
  }

  const cls = rate(field.cls, THRESHOLDS.cls)
  if (cls && cls !== 'good') {
    findings.push({
      checkId: ID,
      category: 'performance',
      severity: cls === 'poor' ? 'medium' : 'low',
      title: `Cumulative Layout Shift is ${formatCls(field.cls)} for real users`,
      description:
        `${subject} experience a Cumulative Layout Shift of ${formatCls(field.cls)} at the 75th ` +
        'percentile; good is 0.1 or below. The page moves under them as it loads — this is what makes ' +
        'someone tap the wrong button or lose the line they were reading. It is almost always content ' +
        'arriving into space that was never reserved for it.',
      evidence: evidence(psi, field, { metric: 'CLS', value: field.cls, rating: cls }),
      remediation:
        'Reserve space for anything that loads late: width and height on every image and iframe, a ' +
        'fixed height for ad and embed slots, and no content inserted above what is already visible.',
      fixPrompt:
        `Real users of ${ctx.finalUrl.href} experience a Cumulative Layout Shift of ` +
        `${formatCls(field.cls)} (75th percentile, mobile). Target is 0.1 or below.\n\n` +
        'Open the page in Chrome DevTools with the Performance panel recording, reload, and use the ' +
        '"Layout Shift" entries to see exactly which elements move. Then, in this repository:\n\n' +
        '  - Give every <img> and <video> explicit width and height attributes (or a CSS aspect-ratio) ' +
        'so the browser reserves the box before the file arrives.\n' +
        '  - Reserve a fixed min-height for anything injected later: ads, embeds, cookie banners, ' +
        'skeleton-to-content swaps.\n' +
        '  - Never insert content above existing content after load — a banner that pushes the page ' +
        'down is the largest single source of CLS.\n' +
        '  - For web fonts, use `font-display: optional` or preload the font so the fallback-to-webfont ' +
        'swap does not reflow the text.\n' +
        '  - Animate with `transform` and `opacity` only; animating width, height, top or left shifts ' +
        'layout and counts against this metric.',
    })
  }

  return findings
}

/**
 * Lab fallback, used only when a URL has no real-user data — which is most
 * sites. Everything here is one simulated load, so severities drop a step and
 * the wording leads with what the number is not.
 */
function fromLab(ctx: CheckContext, psi: PageSpeedSummary): Finding[] {
  const lab = psi.lab
  if (!lab) return []

  const findings: Finding[] = []
  const preamble =
    `${ctx.finalUrl.hostname} has too few visitors for Chrome to report real-user data, so this is a ` +
    'single simulated load on a throttled mid-range phone. Treat it as a direction to investigate ' +
    'rather than a measurement of what this site\'s visitors experience.'

  const lcp = rate(lab.lcpMs, THRESHOLDS.lcp)
  if (lcp === 'poor') {
    findings.push({
      checkId: ID,
      category: 'performance',
      severity: 'medium',
      title: `Largest Contentful Paint is ${formatMs(lab.lcpMs)} in a simulated load`,
      description:
        `${preamble} In that run the largest element took ${formatMs(lab.lcpMs)} to render, against a ` +
        '2.5 s target. A figure this far past the threshold usually survives the move to real ' +
        'hardware, so it is worth profiling.',
      evidence: evidence(psi, null, { metric: 'LCP', value: lab.lcpMs, rating: lcp }),
      remediation:
        'Run Lighthouse locally to identify the LCP element, then remove what delays it — a ' +
        'lazy-loaded hero image, a render-blocking stylesheet, or a slow first byte.',
      fixPrompt:
        `A simulated mobile load of ${ctx.finalUrl.href} reports a Largest Contentful Paint of ` +
        `${formatMs(lab.lcpMs)} against a 2.5 s target. This is lab data — confirm it on a real ` +
        'device before rewriting anything.\n\n' +
        'Run Lighthouse against this URL and read the "Largest Contentful Paint element" entry, then ' +
        'in this repository: make sure that element is not lazy-loaded, give images explicit ' +
        'dimensions and a modern format, preload the font if the LCP element is text, and defer or ' +
        'async every script that is not needed for first paint.',
    })
  }

  const cls = rate(lab.cls, THRESHOLDS.cls)
  if (cls === 'poor') {
    findings.push({
      checkId: ID,
      category: 'performance',
      severity: 'low',
      title: `Cumulative Layout Shift is ${formatCls(lab.cls)} in a simulated load`,
      description:
        `${preamble} In that run the layout shifted by ${formatCls(lab.cls)} against a 0.1 target. Lab ` +
        'CLS misses shifts caused by interaction and by content that only some visitors see, so the ' +
        'real figure is often higher rather than lower.',
      evidence: evidence(psi, null, { metric: 'CLS', value: lab.cls, rating: cls }),
      remediation:
        'Set width and height on images and iframes, reserve height for late-loading embeds, and ' +
        'never insert content above what is already on screen.',
      fixPrompt:
        `A simulated mobile load of ${ctx.finalUrl.href} reports a Cumulative Layout Shift of ` +
        `${formatCls(lab.cls)} against a 0.1 target.\n\n` +
        'Record the page in the Chrome DevTools Performance panel and read the Layout Shift entries to ' +
        'see which elements move. In this repository: add explicit width/height (or aspect-ratio) to ' +
        'every image and iframe, give injected elements such as banners and embeds a reserved ' +
        'min-height, and animate only transform and opacity.',
    })
  }

  const tbt = rate(lab.tbtMs, THRESHOLDS.tbt)
  if (tbt === 'poor') {
    findings.push({
      checkId: ID,
      category: 'performance',
      severity: 'low',
      title: `Main thread is blocked for ${formatMs(lab.tbtMs)} in a simulated load`,
      description:
        `${preamble} Total Blocking Time measures how long the main thread was too busy to respond to ` +
        `input — ${formatMs(lab.tbtMs)} here, against a 200 ms target. It is the lab's stand-in for ` +
        'INP, since a synthetic load has no real interactions to measure, and it points at the same ' +
        'cause: too much JavaScript running at startup.',
      evidence: evidence(psi, null, { metric: 'TBT', value: lab.tbtMs, rating: tbt }),
      remediation:
        'Reduce the JavaScript executed during load — defer what is not needed for first paint and ' +
        'split long tasks so the browser can respond between them.',
      fixPrompt:
        `A simulated mobile load of ${ctx.finalUrl.href} reports a Total Blocking Time of ` +
        `${formatMs(lab.tbtMs)} against a 200 ms target: the main thread is busy with JavaScript ` +
        'during load.\n\n' +
        'Record a performance profile and find the long tasks (over 50 ms). In this repository: ' +
        'defer or async scripts not needed for first paint, code-split large bundles so a route only ' +
        'loads what it uses, check whether interactive client components could be server-rendered ' +
        'instead of hydrated, and break long synchronous work into chunks that yield to the browser.',
    })
  }

  return findings
}

/** Every finding carries the full measurement, so nobody has to trust one number. */
function evidence(
  psi: PageSpeedSummary,
  field: PageSpeedSummary['field'],
  focus: { metric: string; value: number | null; rating: Rating },
) {
  return {
    ...focus,
    source: field ? `CrUX field data (${field.scope}-level, 75th percentile)` : 'Lighthouse lab run',
    strategy: psi.strategy,
    labScore: psi.labScore,
    ...(field ? { field } : { lab: psi.lab }),
  }
}

/** null in, null out — an unmeasured metric has no rating and produces no finding. */
function rate(value: number | null, threshold: { good: number; poor: number }): Rating | null {
  if (value === null) return null
  if (value <= threshold.good) return 'good'
  return value > threshold.poor ? 'poor' : 'needs-improvement'
}

function formatMs(value: number | null): string {
  if (value === null) return 'unknown'
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`
}

function formatCls(value: number | null): string {
  return value === null ? 'unknown' : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
