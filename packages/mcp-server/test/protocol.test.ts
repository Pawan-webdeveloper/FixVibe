/**
 * The wire, against the real process.
 *
 * These spawn src/index.ts and talk to it over a pipe rather than importing
 * anything, because what is being tested IS the transport: the framing, the
 * buffering, and the rule that stdout carries JSON-RPC and nothing else. An
 * in-process test of a parsed message would pass while the server wrote a
 * banner to stdout and every host dropped the connection.
 *
 * No API key is set, so nothing here reaches the network. The tools report
 * that, which is itself one of the behaviours worth pinning.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url))

interface Message {
  id?: string | number | null
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

class Server {
  private child: ChildProcessWithoutNullStreams
  private buffer = ''
  private received: Message[] = []
  private waiters: Array<() => void> = []

  constructor(env: Record<string, string> = {}) {
    this.child = spawn('node', ['--experimental-strip-types', '--no-warnings', ENTRY], {
      env: { ...process.env, DARVIN_API_KEY: '', DARVIN_API_URL: '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let newline = this.buffer.indexOf('\n')
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline).trim()
        this.buffer = this.buffer.slice(newline + 1)
        if (line) this.received.push(JSON.parse(line) as Message)
        newline = this.buffer.indexOf('\n')
      }
      this.waiters.splice(0).forEach((resolve) => resolve())
    })
  }

  /** Written raw so a test can control exactly how a message is chunked. */
  write(raw: string): void {
    this.child.stdin.write(raw)
  }

  send(message: Record<string, unknown>): void {
    this.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  }

  async awaitId(id: string | number, timeoutMs = 8000): Promise<Message> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = this.received.find((m) => m.id === id)
      if (found) return found
      if (Date.now() > deadline) throw new Error(`timed out waiting for id ${id}`)
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
        setTimeout(resolve, 50)
      })
    }
  }

  /** Everything seen so far — used to assert that something was NOT answered. */
  all(): readonly Message[] {
    return this.received
  }

  async settle(ms = 400): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  stop(): void {
    this.child.kill()
  }
}

let server: Server

beforeEach(() => {
  server = new Server()
})

afterEach(() => {
  server.stop()
})

async function handshake(s: Server): Promise<Message> {
  s.send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
  const result = await s.awaitId(1)
  s.send({ method: 'notifications/initialized' })
  return result
}

describe('initialize', () => {
  it('answers with capabilities and server info', async () => {
    const message = await handshake(server)
    expect(message.result?.['capabilities']).toEqual({ tools: {} })
    expect(message.result?.['serverInfo']).toEqual({ name: 'darvin', version: '0.1.0' })
  })

  it('echoes the protocol version the client asked for', async () => {
    // The only methods this server implements have been identical in every
    // published revision, so echoing is both honest and the behaviour least
    // likely to fail against a host newer than the code.
    server.send({ id: 1, method: 'initialize', params: { protocolVersion: '2031-01-01' } })
    expect((await server.awaitId(1)).result?.['protocolVersion']).toBe('2031-01-01')
  })

  it('falls back to a known version when the client names none', async () => {
    server.send({ id: 1, method: 'initialize', params: {} })
    expect(typeof (await server.awaitId(1)).result?.['protocolVersion']).toBe('string')
  })
})

describe('tools/list', () => {
  it('lists all five tools with usable schemas', async () => {
    await handshake(server)
    server.send({ id: 2, method: 'tools/list' })
    const tools = (await server.awaitId(2)).result?.['tools'] as Array<Record<string, unknown>>

    expect(tools.map((t) => t['name']).sort()).toEqual([
      'get_fix_prompt',
      'get_scan',
      'list_findings',
      'list_projects',
      'run_scan',
    ])

    for (const tool of tools) {
      // A tool the model cannot understand is a tool it will not call.
      expect(typeof tool['description']).toBe('string')
      expect((tool['description'] as string).length).toBeGreaterThan(40)
      const schema = tool['inputSchema'] as Record<string, unknown>
      expect(schema['type']).toBe('object')
      expect(schema['additionalProperties']).toBe(false)
    }
  })
})

describe('notifications', () => {
  it('never answers a message with no id', async () => {
    await handshake(server)
    const before = server.all().length

    server.send({ method: 'notifications/initialized' })
    server.send({ method: 'notifications/cancelled', params: { requestId: 9 } })
    // Even an unknown notification: a host should see silence, not an error it
    // did not ask for. Replying to a notification is a protocol violation.
    server.send({ method: 'notifications/somethingNewer' })
    await server.settle()

    expect(server.all().length).toBe(before)
  })
})

describe('framing', () => {
  it('handles several messages arriving in one chunk', async () => {
    await handshake(server)
    server.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'ping' })}\n` +
        `${JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'ping' })}\n`,
    )
    expect((await server.awaitId(10)).result).toEqual({})
    expect((await server.awaitId(11)).result).toEqual({})
  })

  it('handles one message split across chunks', async () => {
    // A deep scan's report is comfortably larger than a pipe buffer, so a
    // parser that assumed one chunk was one message would fail on exactly the
    // payloads that matter.
    await handshake(server)
    const raw = JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'tools/list' })
    server.write(raw.slice(0, 15))
    await server.settle(100)
    server.write(`${raw.slice(15)}\n`)

    expect((await server.awaitId(12)).result?.['tools']).toHaveLength(5)
  })

  it('ignores blank lines between messages', async () => {
    await handshake(server)
    server.write('\n\n   \n')
    server.send({ id: 13, method: 'ping' })
    expect((await server.awaitId(13)).result).toEqual({})
  })
})

describe('errors', () => {
  it('reports unparseable input against a null id', async () => {
    server.write('this is not json\n')
    const message = await server.awaitId(null as unknown as number)
    expect(message.error?.code).toBe(-32700)
  })

  it('answers an unknown method with method-not-found', async () => {
    await handshake(server)
    server.send({ id: 14, method: 'resources/list' })
    expect((await server.awaitId(14)).error?.code).toBe(-32601)
  })

  it('rejects a request with no method', async () => {
    server.send({ id: 15 })
    expect((await server.awaitId(15)).error?.code).toBe(-32600)
  })
})

describe('tools/call without configuration', () => {
  it('names the variable to set rather than failing to start', async () => {
    /*
     * Exiting on a missing key makes the host report "server failed to start"
     * with no detail, and the person reading that has to guess. Connecting,
     * listing tools, and saying exactly what to set is the version that gets
     * fixed in one step.
     */
    await handshake(server)
    server.send({ id: 16, method: 'tools/call', params: { name: 'list_projects', arguments: {} } })
    const result = (await server.awaitId(16)).result!

    expect(result['isError']).toBe(true)
    const text = (result['content'] as Array<{ text: string }>)[0]!.text
    expect(text).toContain('DARVIN_API_KEY')
  })

  it('reports an unknown tool as content, not as a protocol error', async () => {
    // A protocol error goes to the host and the model never sees it. isError
    // content reaches the model, which can then correct itself.
    await handshake(server)
    server.send({ id: 17, method: 'tools/call', params: { name: 'delete_everything', arguments: {} } })
    const result = (await server.awaitId(17)).result!

    expect(result['isError']).toBe(true)
    expect((result['content'] as Array<{ text: string }>)[0]!.text).toContain('Unknown tool')
  })
})
