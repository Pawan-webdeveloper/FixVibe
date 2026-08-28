import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

/**
 * The HTTP surface, exercised against the real process.
 *
 * The server starts on import (it checks the token and binds a port), so its
 * auth check and refusals cannot be reached without running it. Every case
 * here returns BEFORE a browser is launched — an unauthorised call, an
 * oversized or malformed body, a private URL, an unknown route — so the test
 * needs no Chromium and runs the same in CI as locally. The happy path, which
 * does drive a browser, is covered by the live scan instead.
 */

const SCANNER_ROOT = fileURLToPath(new URL('..', import.meta.url))
const TOKEN = 'test-token-1234567890'
const PORT = 18099
const BASE = `http://127.0.0.1:${PORT}`

let child: ChildProcess

/** Wait for a line on the child's stdout, or reject if it dies first. */
function waitForListening(proc: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes('listening on')) {
        proc.stdout?.off('data', onData)
        resolve()
      }
    }
    proc.stdout?.on('data', onData)
    proc.once('exit', (code) => reject(new Error(`scanner exited early with code ${code}`)))
  })
}

beforeAll(async () => {
  child = spawn(process.execPath, ['--experimental-strip-types', 'src/index.ts'], {
    cwd: SCANNER_ROOT,
    env: { ...process.env, SCANLYFIX_SCANNER_TOKEN: TOKEN, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitForListening(child)
})

afterAll(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM')
    await once(child, 'exit').catch(() => {})
  }
})

const auth = { authorization: `Bearer ${TOKEN}` }

async function post(path: string, body: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })
}

describe('scanner HTTP surface', () => {
  it('answers /health without a token', async () => {
    const res = await fetch(`${BASE}/health`)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('rejects an unknown route with 404', async () => {
    expect((await fetch(`${BASE}/nope`)).status).toBe(404)
  })

  it('refuses /render without the shared secret', async () => {
    const res = await post('/render', JSON.stringify({ url: 'http://8.8.8.8/' }))
    expect(res.status).toBe(401)
  })

  it('refuses /render with the wrong secret', async () => {
    const res = await post('/render', JSON.stringify({ url: 'http://8.8.8.8/' }), {
      authorization: 'Bearer wrong',
    })
    expect(res.status).toBe(401)
  })

  it('refuses /pdf without the shared secret', async () => {
    expect((await post('/pdf', JSON.stringify({ html: '<p>x</p>' }))).status).toBe(401)
  })

  it('400s a malformed body', async () => {
    const res = await post('/render', 'not json', auth)
    expect(res.status).toBe(400)
  })

  it('400s /render with no url', async () => {
    const res = await post('/render', JSON.stringify({}), auth)
    expect(res.status).toBe(400)
  })

  it('refuses to render a private address, before any browser launches', async () => {
    const res = await post('/render', JSON.stringify({ url: 'http://127.0.0.1/' }), auth)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/private|reserved/i)
  })

  it('refuses to render the cloud metadata address', async () => {
    const res = await post('/render', JSON.stringify({ url: 'http://169.254.169.254/' }), auth)
    expect(res.status).toBe(400)
  })

  it('400s /pdf with no html', async () => {
    expect((await post('/pdf', JSON.stringify({ html: '   ' }), auth)).status).toBe(400)
  })

  it('rejects a /pdf body over the 4MB ceiling', async () => {
    // 5MB of HTML: the body-size guard trips mid-stream and aborts the request,
    // so a memory-exhaustion body never accumulates or reaches the browser. The
    // abort surfaces as a reset connection rather than a tidy 400 — either way
    // the body is refused, which is the property that matters. The server must
    // still be alive afterwards, which the next assertion confirms.
    const huge = JSON.stringify({ html: '<p>' + 'a'.repeat(5 * 1024 * 1024) + '</p>' })
    let refused = false
    try {
      const res = await post('/pdf', huge, auth)
      refused = res.status >= 400
    } catch {
      refused = true // connection reset by the size guard
    }
    expect(refused).toBe(true)

    // The process survived the abort and still serves.
    expect((await fetch(`${BASE}/health`)).status).toBe(200)
  })
})

describe('startup', () => {
  it('refuses to start without a token, rather than listening unauthenticated', async () => {
    const proc = spawn(process.execPath, ['--experimental-strip-types', 'src/index.ts'], {
      cwd: SCANNER_ROOT,
      env: { ...process.env, SCANLYFIX_SCANNER_TOKEN: '', PORT: '18100' },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const [code] = (await once(proc, 'exit')) as [number]
    expect(code).toBe(1)
  })
})
