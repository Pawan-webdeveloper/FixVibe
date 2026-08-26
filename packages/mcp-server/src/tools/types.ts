/**
 * What a tool is, and how its arguments are checked.
 *
 * Arguments arrive as untyped JSON from a model, which is the least
 * trustworthy input in the system — not malicious, but confidently wrong: a
 * number where a string belongs, a severity that does not exist, a scanId that
 * is a URL. So every field is narrowed by hand here rather than cast.
 *
 * There is no schema library. `inputSchema` is the JSON Schema the model reads
 * and these helpers are the runtime check, and keeping them adjacent in one
 * small file is what stops the two describing different tools.
 */

/** JSON Schema, loosely typed — it is data the host forwards, not something we execute. */
export type JsonSchema = Record<string, unknown>

export interface ToolContext {
  client: import('../client.ts').DarvinClient
}

/**
 * A tool that did not produce what was asked for.
 *
 * Returned rather than thrown, because an API refusal is an OUTCOME — "you are
 * out of scans this month" is an answer the model should relay, not an
 * exception. Throwing stays reserved for our own bugs.
 *
 * It exists as a distinct shape only so callTool can set MCP's `isError`.
 * Without that flag the host renders an unauthorized 401 as a successful call
 * whose text happens to mention a failure, and a model is markedly less likely
 * to act on it.
 */
export interface ToolFailure {
  readonly isError: true
  readonly text: string
}

export type ToolOutput = string | ToolFailure

export function failure(text: string): ToolFailure {
  return { isError: true, text }
}

export function isFailure(output: ToolOutput): output is ToolFailure {
  return typeof output !== 'string'
}

export interface Tool {
  name: string
  /**
   * Read by the model to decide whether to call this at all, so it says what
   * the tool is FOR and what it costs — not what it does internally.
   */
  description: string
  inputSchema: JsonSchema
  /** A plain string succeeded; a ToolFailure did not. Throwing is our own bug. */
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput>
}

export class BadArgument extends Error {}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadArgument(`\`${key}\` is required and must be a non-empty string.`)
  }
  return value.trim()
}

export function optionalEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    // Named rather than coerced. Silently downgrading a model's "deep" to
    // "fast" returns a report missing the checks it asked for, and the model
    // has no way to notice it was given something else.
    throw new BadArgument(`\`${key}\` must be one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new BadArgument(`\`${key}\` must be a string.`)
  return value.trim()
}

/** Clamped rather than rejected: an out-of-range number is a guess, not an error. */
export function optionalNumber(
  args: Record<string, unknown>,
  key: string,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) throw new BadArgument(`\`${key}\` must be a number.`)
  return Math.min(max, Math.max(min, Math.round(n)))
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function requireScanId(args: Record<string, unknown>): string {
  const value = requireString(args, 'scanId')
  // Checked here so a mistyped id costs no round trip and the model is told
  // what was wrong with it, rather than getting a bare 404.
  if (!UUID.test(value)) throw new BadArgument('`scanId` must be a scan UUID, as returned by run_scan.')
  return value
}

/**
 * The API's failure, rendered for a model that has to decide what to do next.
 *
 * The machine-readable `code` leads, because it is what lets a model tell
 * "out of scans this month" apart from "slow down for an hour" without
 * matching on prose.
 */
export function describeFailure(api: { code: string; message: string; status: number }): ToolFailure {
  return failure(`Darvin API error (${api.code}${api.status ? `, HTTP ${api.status}` : ''}): ${api.message}`)
}
