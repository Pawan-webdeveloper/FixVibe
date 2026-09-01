/**
 * The repo-scanner worker's HTTP surface.
 *
 * Mirrors apps/scanner: one shared-secret token, fail-closed, node:http rather
 * than a framework. The web app's Inngest step (lib/repo-scanner.ts) is the only
 * intended caller; nothing else should be able to reach this.
 *
 * ## Fail closed, deliberately and loudly
 *
 * This service clones arbitrary GitHub repositories and executes pinned scanner
 * binaries over them. SCANLYFIX_REPO_SCANNER_TOKEN is REQUIRED: with no token
 * configured the process refuses to start rather than listening without
 * authentication. There is no development escape hatch, because the development
 * escape hatch is what ends up deployed.
 *
 * ## Endpoints
 *   GET  /health   — liveness; reports the REGISTERED tool versions (no exec).
 *   GET  /version  — runs each binary and reports pinned vs detected versions.
 *   POST /scan     — the scan seam. In this build the GitHub clone pipeline is
 *                    not wired yet, so a valid request is answered 501 rather
 *                    than with fake findings; see runScan.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { detectToolVersions, registeredToolVersions } from './tools.ts'

const PORT = Number(process.env['PORT'] ?? 8081)
const TOKEN = process.env['SCANLYFIX_REPO_SCANNER_TOKEN'] ?? ''

/** A clone + gitleaks + osv-scanner run is heavy; serialize them. */
const MAX_CONCURRENT_SCANS = 1
const MAX_BODY_BYTES = 8 * 1024
/** Hard cap on the history window the caller may request. */
export const MAX_HISTORY_DEPTH = 2000

export interface ScanRequest {
  installationId: number
  owner: string
  name: string
  defaultBranch: string
  historyDepth?: number
}

if (!TOKEN) {
  console.error(
    'SCANLYFIX_REPO_SCANNER_TOKEN is not set. This service clones GitHub repositories and runs\n' +
      'secret/vulnerability scanners over them; without a shared secret anyone who can reach the\n' +
      'port can trigger scans and read the findings. Refusing to start.',
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
    // Liveness only: report the declared toolchain without exec-ing binaries.
    return send(response, 200, { ok: true, inFlight, tools: registeredToolVersions() })
  }

  const isVersion = request.method === 'GET' && request.url === '/version'
  const isScan = request.method === 'POST' && request.url === '/scan'
  if (!isVersion && !isScan) {
    return send(response, 404, { error: 'Not found' })
  }
  if (!authorized(request)) {
    // No detail: an unauthenticated caller learns nothing about why.
    return send(response, 401, { error: 'Unauthorized' })
  }

  if (isVersion) {
    const tools = await detectToolVersions()
    return send(response, 200, { node: process.version, tools })
  }

  // POST /scan
  if (inFlight >= MAX_CONCURRENT_SCANS) {
    response.setHeader('retry-after', '5')
    return send(response, 503, { error: 'Busy' })
  }

  let body: unknown
  try {
    body = JSON.parse(await readBody(request))
  } catch {
    return send(response, 400, { error: 'Body must be JSON' })
  }

  const parsed = parseScanRequest(body)
  if (!parsed.ok) {
    return send(response, 400, { error: parsed.error })
  }

  inFlight += 1
  const startedAt = performance.now()
  try {
    const result = await runScan(parsed.value)
    send(response, result.status, { ...result.body, durationMs: Math.round(performance.now() - startedAt) })
  } finally {
    inFlight -= 1
  }
}

/**
 * The scan seam. This build ships the worker shell and the pinned, checksummed
 * gitleaks/osv-scanner binaries, but not yet the GitHub App auth + bounded-clone
 * pipeline that feeds them (the plan's auth.ts / shallow.ts / deep.ts). Until
 * that lands a valid scan is answered 501 — an honest failure the executor
 * records as a `failed` scan — rather than empty findings that would read as
 * "clean repo".
 */
async function runScan(request: ScanRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  console.log(`scan requested for ${request.owner}/${request.name} (pipeline not wired in this build)`)
  return {
    status: 501,
    body: {
      error:
        'The github-scanner clone pipeline (GitHub App auth + gitleaks/osv-scanner over a bounded clone) ' +
        'is not implemented in this build. The worker shell and pinned toolchain are in place.',
      findings: [],
      errors: [],
    },
  }
}

/**
 * Pure request validation, split out so it is unit-testable without an HTTP
 * socket. Accepts the current web-side contract (installationId/owner/name/
 * defaultBranch) and tolerates the fields the pipeline will add (historyDepth),
 * ignoring anything else it is sent.
 */
export function parseScanRequest(raw: unknown): { ok: true; value: ScanRequest } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'Body must be a JSON object' }
  }
  const body = raw as Record<string, unknown>

  const installationId = body['installationId']
  if (typeof installationId !== 'number' || !Number.isInteger(installationId) || installationId <= 0) {
    return { ok: false, error: 'installationId must be a positive integer' }
  }
  const owner = body['owner']
  if (typeof owner !== 'string' || owner.trim() === '') {
    return { ok: false, error: 'owner is required' }
  }
  const name = body['name']
  if (typeof name !== 'string' || name.trim() === '') {
    return { ok: false, error: 'name is required' }
  }
  const defaultBranch = body['defaultBranch']
  if (typeof defaultBranch !== 'string' || defaultBranch.trim() === '') {
    return { ok: false, error: 'defaultBranch is required' }
  }

  const value: ScanRequest = { installationId, owner, name, defaultBranch }

  const historyDepth = body['historyDepth']
  if (historyDepth !== undefined) {
    if (typeof historyDepth !== 'number' || !Number.isInteger(historyDepth) || historyDepth <= 0) {
      return { ok: false, error: 'historyDepth must be a positive integer' }
    }
    // Callers may ask for less; nobody may ask for more than the cap.
    value.historyDepth = Math.min(historyDepth, MAX_HISTORY_DEPTH)
  }

  return { ok: true, value }
}

/**
 * Constant-time comparison. A token check that returns early on the first wrong
 * byte leaks the token one character at a time to anyone patient enough to
 * measure the difference.
 */
function authorized(request: IncomingMessage): boolean {
  // Matches the header apps/web's lib/repo-scanner.ts sends.
  const presented = request.headers['x-scanner-token']
  const header = Array.isArray(presented) ? presented[0] : presented
  const a = Buffer.from(header ?? '')
  const b = Buffer.from(TOKEN)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readBody(request: IncomingMessage, limit = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
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
    server.close(() => process.exit(0))
  })
}

server.listen(PORT, () => console.log(`scanlyfix github-scanner listening on :${PORT}`))
