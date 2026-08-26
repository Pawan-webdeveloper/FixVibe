/**
 * The shared headless browser.
 *
 * One browser process for the life of the service, one fresh, isolated
 * BrowserContext per render. That split matters: launching Chromium costs
 * hundreds of milliseconds and a lot of memory, so it is reused; but a context
 * carries cookies, storage and service workers, so reusing one would let the
 * previous site under test influence the next. Contexts are cheap. Browsers
 * are not.
 *
 * Every page is created through `withPage`, which is the only place that knows
 * how to install the SSRF request guard and how to guarantee teardown. Nothing
 * else in this service may create a page — a page opened elsewhere would be a
 * page rendering somebody's URL with no interceptor attached.
 *
 * ## Finding a browser to drive
 *
 * This depends on `playwright-core`, not `playwright`, so installing the
 * workspace does not pull down 150 MB of Chromium for people who will never
 * run this service. The executable is resolved in order:
 *
 *   1. PLAYWRIGHT_EXECUTABLE_PATH — explicit, wins over everything.
 *   2. The Docker image's bundled Chromium (the official Playwright base image
 *      installs it where playwright-core expects it).
 *   3. The `chrome` channel, i.e. a Google Chrome already on the machine,
 *      which is how this is meant to be run locally.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { makeRequestGuard } from './guard.ts'

/** A page that has not settled by now is not going to. */
export const NAVIGATION_TIMEOUT_MS = 20_000
/** Whole-render ceiling, navigation plus whatever the job then does. */
export const RENDER_TIMEOUT_MS = 45_000

const VIEWPORT = { width: 1280, height: 900 }
/**
 * Mobile-shaped user agent is deliberately NOT used: the engine's own fetches
 * identify as DarvinScanner, and a service that lied about being a phone would
 * produce a report about a page nobody was served.
 */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36 DarvinScanner/0.1 (+https://darvin.dev)'

let browserPromise: Promise<Browser> | null = null

function launch(): Promise<Browser> {
  const executablePath = process.env['PLAYWRIGHT_EXECUTABLE_PATH']
  const args = [
    // Chromium's own sandbox is redundant inside a container that is already
    // confined, and it cannot start without extra kernel capabilities there.
    // Kept ON outside containers, where it is a real boundary.
    ...(process.env['DARVIN_DISABLE_BROWSER_SANDBOX'] === '1' ? ['--no-sandbox'] : []),
    '--disable-dev-shm-usage', // /dev/shm is tiny in containers; without this Chromium crashes
    '--disable-gpu',
  ]

  if (executablePath) return chromium.launch({ executablePath, args })

  // Bundled Chromium if the image installed one, otherwise a local Chrome.
  return chromium.launch({ args }).catch(() => chromium.launch({ channel: 'chrome', args }))
}

export function browser(): Promise<Browser> {
  browserPromise ??= launch().catch((error) => {
    // Do not cache a failed launch: the next request should try again rather
    // than inherit a rejected promise for the life of the process.
    browserPromise = null
    throw error
  })
  return browserPromise
}

export async function closeBrowser(): Promise<void> {
  const running = browserPromise
  browserPromise = null
  if (running) await (await running).close().catch(() => {})
}

/**
 * Runs `job` against a freshly navigated page and tears everything down,
 * whatever happens.
 *
 * The route handler is the second SSRF layer: the target URL was checked
 * before we got here, but nothing has vetted the hundred subresource requests
 * its HTML is about to make.
 */
export async function withPage<T>(url: URL, job: (page: Page) => Promise<T>): Promise<T> {
  const context: BrowserContext = await (await browser()).newContext({
    viewport: VIEWPORT,
    userAgent: USER_AGENT,
    // A site with a broken certificate is exactly the kind we want to finish
    // auditing, and the TLS checks already report on the certificate itself.
    ignoreHTTPSErrors: true,
    javaScriptEnabled: true,
    serviceWorkers: 'block',
  })

  try {
    context.setDefaultTimeout(NAVIGATION_TIMEOUT_MS)
    const allowed = makeRequestGuard()
    await context.route('**/*', async (route) => {
      if (await allowed(route.request().url())) await route.continue().catch(() => {})
      else await route.abort('blockedbyclient').catch(() => {})
    })

    const page = await context.newPage()
    // 'load' rather than 'networkidle': networkidle never fires on pages with
    // polling or analytics beacons, which is most of the commercial web, and
    // waiting for it turns every such scan into a timeout.
    await page.goto(url.href, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS })
    // A short settle so client-rendered frameworks have mounted before we read
    // the DOM. Not a correctness guarantee — nothing is, for an SPA — but it
    // is the difference between reading an empty shell and reading the page.
    await page.waitForTimeout(1_500)

    return await job(page)
  } finally {
    await context.close().catch(() => {})
  }
}

/**
 * Renders HTML we produced ourselves, with the network sealed off.
 *
 * Separate from withPage because the threat is inverted. There, a URL we do
 * not control is navigated to and the guard vets its subresources. Here the
 * document is ours and there is no navigation at all — so every request is
 * blocked outright rather than filtered. That is not paranoia about our own
 * markup: it is what makes this endpoint safe to expose, because a caller who
 * could smuggle an <img src="http://169.254.169.254/..."> into the HTML would
 * otherwise have turned the PDF renderer into the SSRF proxy the guard in
 * withPage exists to prevent.
 *
 * It also makes rendering deterministic. A report that silently fetched a font
 * would produce a different PDF on a bad network day.
 */
export async function withHtmlPage<T>(html: string, job: (page: Page) => Promise<T>): Promise<T> {
  const context: BrowserContext = await (await browser()).newContext({
    viewport: VIEWPORT,
    userAgent: USER_AGENT,
    // Nothing in a generated report needs to run, and disabling it removes the
    // last way markup could reach outward.
    javaScriptEnabled: false,
    serviceWorkers: 'block',
  })

  try {
    context.setDefaultTimeout(NAVIGATION_TIMEOUT_MS)
    await context.route('**/*', (route) => route.abort('blockedbyclient').catch(() => {}))

    const page = await context.newPage()
    // 'load' would wait on the very subresources that were just blocked.
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
    return await job(page)
  } finally {
    await context.close().catch(() => {})
  }
}
