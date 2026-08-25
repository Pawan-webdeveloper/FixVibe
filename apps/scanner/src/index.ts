/**
 * The browser tier's HTTP surface.
 *
 * One endpoint, POST /render, which takes a URL and returns some combination
 * of the rendered DOM, an axe-core audit and a screenshot. The engine calls
 * it; nothing else should be able to.
 *
 * ## Fail closed, deliberately and loudly
 *
 * A service that points a real browser at a URL you give it and returns what
 * it saw is an SSRF proxy with extra steps. Behind a company VPN or on a cloud
 * host it can reach metadata endpoints, internal admin panels and databases.
 * So DARVIN_SCANNER_TOKEN is REQUIRED: with no token configured this process
 * refuses to start rather than listening without authentication. There is no
 * development escape hatch, because the development escape hatch is what ends
 * up deployed.
 *
 * Written against node:http rather than a framework. The whole surface is one
 * route, one auth check and a JSON body; a framework here would be more
 * dependency than code.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { SsrfError } from '@darvin/checks'
import { closeBrowser, RENDER_TIMEOUT_MS, withPage } from './browser.ts'
import { assertRenderable } from './guard.ts'
import { axeAudit, type AxeSummary } from './jobs/axe-audit.ts'
import { renderedContent, type RenderedContent } from './jobs/rendered-content.ts'
import { screenshot, type Screenshot } from './jobs/screenshot.ts'

const PORT = Number(process.env['PORT'] ?? 8080)
const TOKEN = process.env['DARVIN_SCANNER_TOKEN'] ?? ''

/**
 * Chromium holds a lot of memory per context. Two at a time keeps a 1 GB
 * container alive; the caller waits rather than the process dying, which is
 * the better failure for a queue-driven backend.
 */
const MAX_CONCURRENT_RENDERS = 2
const MAX_BODY_BYTES = 8 * 1024

type JobName = 'content' | 'axe' | 'screenshot'
const ALL_JOBS: readonly JobName[] = ['content', 'axe', 'screenshot']

interface RenderRequest {
  url?: unknown
  jobs?: unknown
}

export interface RenderResponse {
  url: string
  content?: RenderedContent
  axe?: AxeSummary
  screenshot?: Screenshot | null
  /**
   * Per-job failures, keyed by job name. A job that fails does NOT fail the
   * render: the page loaded, and whatever else was asked for is still worth
   * returning. The caller decides what a missing piece means — for the engine
   * it means the checks reading it stay silent, which is the same thing a
   * missing capability means everywhere else in this system.
   */
  failed?: Partial<Record<JobName, string>>
  durationMs: number
}

if (!TOKEN) {
  console.error(
    'DARVIN_SCANNER_TOKEN is not set. This service drives a real browser to arbitrary URLs and\n' +
      'returns what it sees; without a shared secret anyone who can reach the port can read any\n' +
      'URL this host can reach, including internal ones. Refusing to start.',
  )
  process.exit(1)
}

let inFlight = 0

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error('unhandled', error)
    send(response, 500, { error: 'Internal error' })
  })
})

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === 'GET' && request.url === '/health') {
    return send(response, 200, { ok: true, inFlight })
  }
  if (request.method !== 'POST' || request.url !== '/render') {
    return send(response, 404, { error: 'Not found' })
  }
  if (!authorized(request)) {
    // No detail: an unauthenticated caller learns nothing about why.
    return send(response, 401, { error: 'Unauthorized' })
  }
  if (inFlight >= MAX_CONCURRENT_RENDERS) {
    response.setHeader('retry-after', '5')
    return send(response, 503, { error: 'Busy' })
  }

  let body: RenderRequest
  try {
    body = JSON.parse(await readBody(request)) as RenderRequest
  } catch {
    return send(response, 400, { error: 'Body must be JSON' })
  }
  if (typeof body.url !== 'string') return send(response, 400, { error: 'url is required' })

  const jobs = parseJobs(body.jobs)
  if (!jobs) return send(response, 400, { error: `jobs must be a subset of ${ALL_JOBS.join(', ')}` })

  let target: URL
  try {
    target = await assertRenderable(body.url)
  } catch (error) {
    // SsrfError messages are written to be shown to a person, so they pass
    // through; anything else becomes a neutral line.
    const message = error instanceof SsrfError ? error.message : 'Refusing to render that URL'
    return send(response, 400, { error: message })
  }

  inFlight += 1
  const startedAt = performance.now()
  try {
    const result = await withDeadline(
      withPage(target, async (page) => {
        // Sequential, not parallel: they share one page. axe evaluates its own
        // bundle into it, so the DOM snapshot and the screenshot come first.
        const output: Omit<RenderResponse, 'url' | 'durationMs'> = {}
        const failed: Partial<Record<JobName, string>> = {}

        const attempt = async <T>(name: JobName, job: () => Promise<T>): Promise<T | undefined> => {
          if (!jobs.includes(name)) return undefined
          try {
            return await job()
          } catch (error) {
            // One job failing must not discard the others. A page whose CSP
            // defeats the audit still has a DOM worth returning.
            failed[name] = error instanceof Error ? error.message.split('\n')[0] ?? 'failed' : 'failed'
            return undefined
          }
        }

        output.content = await attempt('content', () => renderedContent(page))
        output.screenshot = await attempt('screenshot', () => screenshot(page))
        output.axe = await attempt('axe', () => axeAudit(page))
        if (Object.keys(failed).length > 0) output.failed = failed
        return output
      }),
    )
    send(response, 200, { url: target.href, ...result, durationMs: Math.round(performance.now() - startedAt) })
  } catch (error) {
    console.error('render failed', target.href, error)
    send(response, 502, { error: 'Could not render that page' })
  } finally {
    inFlight -= 1
  }
}

/**
 * Constant-time comparison. A token check that returns early on the first
 * wrong byte leaks the token one character at a time to anyone patient enough
 * to measure the difference.
 */
function authorized(request: IncomingMessage): boolean {
  const header = request.headers.authorization ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(presented)
  const b = Buffer.from(TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

function parseJobs(value: unknown): JobName[] | null {
  if (value === undefined) return ['content', 'axe'] // the two the engine actually uses
  if (!Array.isArray(value)) return null
  const jobs = value.filter((job): job is JobName => ALL_JOBS.includes(job as JobName))
  return jobs.length === value.length ? jobs : null
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

/**
 * A hard ceiling above the page's own timeouts. Playwright's timeouts cover
 * navigation and each action; this covers the case where the whole job wedges
 * anyway, so a stuck render cannot hold one of two slots forever.
 */
function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`render exceeded ${RENDER_TIMEOUT_MS}ms`)), RENDER_TIMEOUT_MS)
    timer.unref()
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  response.end(payload)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void closeBrowser().then(() => process.exit(0))
    })
  })
}

server.listen(PORT, () => console.log(`darvin scanner listening on :${PORT}`))
