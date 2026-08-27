#!/usr/bin/env -S node --experimental-strip-types

/**
 * ScanlyFix as an MCP server.
 *
 *   claude mcp add scanlyfix --env SCANLYFIX_API_KEY=sf_… \
 *     -- node --experimental-strip-types <repo>/packages/mcp-server/src/index.ts
 *
 * ── Why the protocol is spoken directly ───────────────────────────────────
 *
 * There is no MCP SDK dependency here, matching how this repo handles every
 * other external protocol: lib/email.ts calls Resend with fetch, lib/razorpay.ts
 * signs its own requests, and the database layer talks to Postgres rather than
 * to a vendor client. What that costs is the ~120 lines below; what it buys is
 * that the wire format is readable in one file instead of being a version
 * range in a lockfile.
 *
 * The surface used is deliberately the stable core — initialize, tools/list,
 * tools/call, ping — which has not changed shape across any published protocol
 * revision. Nothing here touches resources, prompts, sampling or roots.
 *
 * ── The two rules of stdio transport ─────────────────────────────────────
 *
 *  1. stdout carries newline-delimited JSON-RPC AND NOTHING ELSE. One stray
 *     console.log corrupts the stream and the host drops the connection with
 *     no useful error, so every diagnostic in this package goes to stderr.
 *     `log()` below is the only writer either way.
 *
 *  2. A message can arrive split across chunks, or several can arrive in one.
 *     stdin is therefore buffered and split on newlines rather than parsed per
 *     chunk — a deep scan's report is comfortably larger than a pipe buffer.
 */

import { createClient, configFromEnv } from './client.ts'
import { BadArgument, isFailure, type Tool } from './tools/types.ts'
import { runScan } from './tools/run-scan.ts'
import { getScan } from './tools/get-scan.ts'
import { listFindings } from './tools/list-findings.ts'
import { listProjects } from './tools/list-projects.ts'
import { getFixPrompt } from './tools/get-fix-prompt.ts'

const SERVER_INFO = { name: 'scanlyfix', version: '0.1.0' }

/**
 * Used only when the client does not name one. Otherwise the client's own
 * version is echoed back — see negotiate().
 */
const FALLBACK_PROTOCOL_VERSION = '2025-06-18'

const TOOLS: readonly Tool[] = [runScan, getScan, listFindings, listProjects, getFixPrompt]

/* -------------------------------------------------------------------------- */
/* JSON-RPC                                                                   */
/* -------------------------------------------------------------------------- */

interface Request {
  jsonrpc: '2.0'
  /** Absent on a notification, which must NOT be answered. */
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INTERNAL_ERROR = -32603

function log(message: string): void {
  process.stderr.write(`[scanlyfix-mcp] ${message}\n`)
}

function send(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...payload })}\n`)
}

function reply(id: string | number, result: unknown): void {
  send({ id, result })
}

function replyError(id: string | number, code: number, message: string): void {
  send({ id, error: { code, message } })
}

/**
 * Echo the client's protocol version back when it names one.
 *
 * The spec allows a server to answer with a version it prefers, and the client
 * may then disconnect. Since the only methods implemented here are the ones
 * that have been identical in every revision, echoing is both honest about
 * what this speaks and the behaviour least likely to fail against a host newer
 * than this file.
 */
function negotiate(params: Record<string, unknown> | undefined): string {
  const requested = params?.['protocolVersion']
  return typeof requested === 'string' && requested.length > 0 ? requested : FALLBACK_PROTOCOL_VERSION
}

/* -------------------------------------------------------------------------- */
/* Tools                                                                      */
/* -------------------------------------------------------------------------- */

const config = configFromEnv()
const client = config ? createClient(config) : null

if (!config) {
  // Deliberately NOT fatal. Exiting here makes the host report "server failed
  // to start" with no detail, and the person reading that has to guess. A
  // server that connects, lists its tools, and answers every call with the
  // exact variable to set is the one that gets fixed in one step.
  log('SCANLYFIX_API_KEY is not set — tools will report this rather than run.')
} else {
  log(`ready · ${TOOLS.length} tools · api ${config.baseUrl}`)
}

const MISSING_KEY =
  'ScanlyFix is not configured: set SCANLYFIX_API_KEY to an API key from ' +
  'https://scanlyfix.com/settings/api-keys (Pro plan). Set SCANLYFIX_API_URL too if you are ' +
  'pointing at a self-hosted or local instance.'

/**
 * A tool failure is CONTENT, not a JSON-RPC error.
 *
 * That distinction is the whole reason this function exists. A protocol error
 * is delivered to the host and the model never sees it; `isError` content is
 * handed to the model, which can then read "you are out of scans this month"
 * and tell the user instead of retrying into the same wall.
 */
async function callTool(name: unknown, rawArgs: unknown): Promise<{ text: string; isError: boolean }> {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) {
    return { text: `Unknown tool "${String(name)}". Available: ${TOOLS.map((t) => t.name).join(', ')}.`, isError: true }
  }
  if (!client) return { text: MISSING_KEY, isError: true }

  // Absent arguments are an empty object, not an error: list_projects takes
  // none, and some hosts omit the key entirely rather than sending {}.
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
    ? (rawArgs as Record<string, unknown>)
    : {}

  try {
    const output = await tool.run(args, { client })
    // A ToolFailure is an API refusal the model should act on; a plain string
    // is a result. The distinction is what MCP's isError flag carries.
    return isFailure(output) ? { text: output.text, isError: true } : { text: output, isError: false }
  } catch (error) {
    if (error instanceof BadArgument) {
      // The model can fix this one itself, so it gets the precise complaint.
      return { text: `Invalid arguments for ${tool.name}: ${error.message}`, isError: true }
    }
    // Ours. The model gets a neutral sentence; the detail goes to stderr,
    // where it does not corrupt the protocol stream.
    log(`tool ${tool.name} threw: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    return { text: `${tool.name} failed unexpectedly. This is a ScanlyFix-side problem, not a problem with the site.`, isError: true }
  }
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                   */
/* -------------------------------------------------------------------------- */

async function handle(request: Request): Promise<void> {
  const { id, method, params } = request

  // A notification has no id and must never be answered — replying to one is
  // a protocol violation, and `notifications/initialized` arrives on every
  // single connection.
  const isNotification = id === undefined

  switch (method) {
    case 'initialize':
      if (!isNotification) {
        reply(id, {
          protocolVersion: negotiate(params),
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        })
      }
      return

    case 'notifications/initialized':
    case 'notifications/cancelled':
// Nothing to do, and nothing to say. Both are notifications.
      return

    case 'ping':
      if (!isNotification) reply(id, {})
      return

    case 'tools/list':
      if (!isNotification) {
        reply(id, {
          tools: TOOLS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        })
      }
      return

    case 'tools/call': {
      if (isNotification) return
      const { text, isError } = await callTool(params?.['name'], params?.['arguments'])
      reply(id, { content: [{ type: 'text', text }], isError })
      return
    }

    default:
      // Notifications are never answered, including unknown ones — a host that
      // sends a notification this file has not heard of should see silence,
      // not an error it did not ask for.
      if (!isNotification) replyError(id, METHOD_NOT_FOUND, `Unknown method: ${method}`)
  }
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                  */
/* -------------------------------------------------------------------------- */

let buffer = ''

process.stdin.setEncoding('utf8')

process.stdin.on('data', (chunk: string) => {
  buffer += chunk

  // Split on newlines and keep the remainder: a single read can carry several
  // messages, or half of one.
  let newline = buffer.indexOf('\n')
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) void dispatch(line)
    newline = buffer.indexOf('\n')
  }
})

process.stdin.on('end', () => process.exit(0))

async function dispatch(line: string): Promise<void> {
  let request: Request
  try {
    request = JSON.parse(line) as Request
  } catch {
    // No id to answer against, so this is a bare error object. The spec's null
    // id is exactly for this case.
    send({ id: null, error: { code: PARSE_ERROR, message: 'Invalid JSON' } })
    return
  }

  if (typeof request?.method !== 'string') {
    if (request?.id !== undefined) replyError(request.id, INVALID_REQUEST, 'Missing method')
    return
  }

  try {
    await handle(request)
  } catch (error) {
    log(`dispatch failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    if (request.id !== undefined) replyError(request.id, INTERNAL_ERROR, 'Internal error')
  }
}

// A pipe closed by the host is a normal shutdown, not a crash to report.
process.stdout.on('error', () => process.exit(0))
