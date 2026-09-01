/**
 * Pure request validation for POST /scan, split out of index.ts so it can be
 * unit-tested without binding an HTTP socket (importing index.ts starts the
 * server and exits without a token).
 */

/** Hard cap on the history window the caller may request. */
export const MAX_HISTORY_DEPTH = 2000

export interface ScanRequest {
  installationId: number
  owner: string
  name: string
  defaultBranch: string
  historyDepth?: number
}

/**
 * Accepts the current web-side contract (installationId/owner/name/
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
