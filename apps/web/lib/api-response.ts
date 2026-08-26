/**
 * The shape every /api/v1 response has.
 *
 * Separate from the routes because an API's envelope is a published contract:
 * two handlers that each invent their own error object is how a client ends up
 * with `if (body.error)` in one place and `if (body.message)` in another. The
 * MCP server in the next phase is the second consumer, and it will parse
 * exactly this.
 *
 * Errors carry a machine-readable `code` as well as a sentence. The browser
 * routes return only a sentence, which is right for a human reading a form —
 * but a CI job needs to tell "you are out of scans this month" apart from
 * "slow down for an hour", and it cannot do that by matching on prose.
 */

import { NextResponse } from 'next/server'

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'invalid_request'
  | 'not_found'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'server_error'

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  headers?: HeadersInit,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers })
}

/** Where a caller polls or re-reads a scan. Relative, so it is correct behind any host. */
export function scanPath(scanId: string): string {
  return `/api/v1/scan/${scanId}`
}
