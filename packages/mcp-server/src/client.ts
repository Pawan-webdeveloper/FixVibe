/**
 * The Darvin API, from a machine.
 *
 * Plain `fetch` against /api/v1 rather than an SDK, matching how every other
 * external service in this repo is spoken to — lib/email.ts calls Resend
 * directly, lib/razorpay.ts signs its own requests. There is no client library
 * to keep in step with the API, because this file IS the client library and it
 * lives in the same repository as the routes.
 *
 * Every method returns a discriminated result rather than throwing. An MCP
 * tool must turn a failure into something the model can read and act on — "you
 * are out of scans this month" is an answer, not an exception — so the error
 * path carries the API's machine-readable `code` all the way up.
 */

/** Public plans live at darvin.dev; a self-hosted or local instance overrides it. */
const DEFAULT_BASE_URL = 'https://darvin.dev'

export interface ApiFailure {
  ok: false
  /** The API's own code: quota_exceeded, rate_limited, not_found, … */
  code: string
  message: string
  status: number
}

export type ApiResult<T> = ({ ok: true } & T) | ApiFailure

export interface ClientConfig {
  apiKey: string
  baseUrl: string
}

/**
 * Read from the environment, because that is the only channel an MCP server
 * has: it is launched by the host with a fixed argv and an env block, and
 * there is no prompt to ask on.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ClientConfig | null {
  const apiKey = env['DARVIN_API_KEY']?.trim()
  if (!apiKey) return null

  // Trailing slash stripped so `${base}/api/v1/...` cannot produce a double
  // slash, which some hosts answer with a redirect and others with a 404.
  const baseUrl = (env['DARVIN_API_URL']?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
  return { apiKey, baseUrl }
}

export interface ScanRef {
  id: string
  url: string
  profile: string
  status: string
  error?: string | null
}

export interface ScanReport {
  scan: {
    id: string
    url: string
    profile: string
    status: string
    projectId: string | null
    createdAt: string
    startedAt: string | null
    finishedAt: string | null
    durationMs: number | null
    engineVersion: string
    checksRun: number
    checkErrors: Array<{ checkId: string; message: string }>
    error: string | null
  }
  scores: Record<string, unknown> | null
  context: { finalUrl?: string; framework?: string | null; platform?: string | null } | null
  findings: Finding[]
  locked: { count: number; severities: string[] }
  fixPromptAvailable: boolean
}

export interface Finding {
  checkId: string
  category: string
  severity: string
  title: string
  locked: boolean
  description?: string
  remediation?: string
  fixPrompt?: string
  evidence?: Record<string, unknown> | null
}

export interface ProjectSummary {
  id: string
  name: string
  url: string
  slug: string
  verifiedDomain: boolean
  latestScan: { id: string; status: string; profile: string; overall: number | null; createdAt: string } | null
  overallDelta: number | null
}

/**
 * A closure over the config rather than a class.
 *
 * Node's strip-only TypeScript mode cannot compile a constructor parameter
 * property, and this package runs straight from .ts with no build step — so
 * the shape that survives `node --experimental-strip-types` is also the
 * simpler one. The interface is what tools depend on; nothing constructs it
 * except createClient.
 */
export interface DarvinClient {
  startScan(input: { url: string; profile: 'fast' | 'deep'; projectId?: string }): Promise<ApiResult<{ scan: ScanRef }>>
  getScan(scanId: string): Promise<ApiResult<ScanReport>>
  getFixPrompt(scanId: string): Promise<ApiResult<{ prompt: string; issueCount: number; url: string }>>
  listProjects(): Promise<ApiResult<{ projects: ProjectSummary[] }>>
}

export function createClient(config: ClientConfig): DarvinClient {
  async function send<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>> {
    let response: Response
    try {
      response = await fetch(`${config.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (error) {
      // A network failure is not an API error and must not be dressed as one:
      // the commonest cause is DARVIN_API_URL pointing at a server that is not
      // running, and saying so saves the reader from checking their key.
      return {
        ok: false,
        code: 'network_error',
        status: 0,
        message: `Could not reach ${config.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    const text = await response.text()
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      // An HTML error page from a proxy, most likely. The status is the useful
      // part; the body is not JSON and pretending otherwise loses both.
      return {
        ok: false,
        code: 'bad_response',
        status: response.status,
        message: `${config.baseUrl} answered ${response.status} with a non-JSON body.`,
      }
    }

    if (!response.ok) {
      const error = (parsed as { error?: { code?: string; message?: string } }).error
      return {
        ok: false,
        code: error?.code ?? 'http_error',
        status: response.status,
        message: error?.message ?? `Request failed with ${response.status}.`,
      }
    }

    return { ok: true, ...(parsed as T) }
  }

  return {
    startScan: (input) => send('POST', '/api/v1/scan', input),
    getScan: (scanId) => send('GET', `/api/v1/scan/${encodeURIComponent(scanId)}`),
    getFixPrompt: (scanId) => send('GET', `/api/v1/scan/${encodeURIComponent(scanId)}/fix-prompt`),
    listProjects: () => send('GET', '/api/v1/projects'),
  }
}
