/**
 * Scan a site.
 *
 * The one tool that spends somebody else's bandwidth, so it is the one with a
 * cost sentence in its description — a model that knows a deep scan crawls the
 * target picks `fast` when it only wants headers.
 *
 * A fast scan finishes inside the request. A deep one cannot, so this polls
 * until a deadline and then HANDS BACK THE ID rather than waiting forever. A
 * tool call that never returns is worse than one that says "not yet": the host
 * eventually times it out, the model learns nothing, and the scan it started
 * is still running with nobody holding its id.
 */

import { formatReport } from './get-scan.ts'
import {
  describeFailure,
  optionalEnum,
  optionalNumber,
  optionalString,
  failure,
  requireString,
  UUID,
  BadArgument,
  type Tool,
} from './types.ts'

/** Between polls. Short enough to feel responsive, long enough not to be a hot loop. */
const POLL_INTERVAL_MS = 3000

const TERMINAL = new Set(['done', 'failed'])

export const runScan: Tool = {
  name: 'run_scan',
  description:
    'Run a ScanlyFix scan of a URL and return the report. ' +
    'profile "fast" is HTTP-only and finishes in seconds; profile "deep" also crawls the site, renders it ' +
    'in a real browser and measures Core Web Vitals, takes a minute or more, and makes many more requests ' +
    'against the target — use "deep" only when the extra depth is actually wanted. ' +
    'Counts against the account\'s monthly scan allowance.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The site to scan, e.g. https://example.com' },
      profile: {
        type: 'string',
        enum: ['fast', 'deep'],
        description: 'fast (default, seconds, HTTP only) or deep (minutes, crawl + browser + PageSpeed).',
      },
      projectId: {
        type: 'string',
        description:
          'Optional project UUID from list_projects. Attaches the scan to that project\'s history, and ' +
          'unlocks the two backend checks if the project\'s domain is verified.',
      },
      waitSeconds: {
        type: 'number',
        description: 'How long to wait for a deep scan before returning its id to poll. Default 120, max 300.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  async run(args, { client }) {
    const url = requireString(args, 'url')
    const profile = optionalEnum(args, 'profile', ['fast', 'deep'] as const, 'fast')
    const projectId = optionalString(args, 'projectId')
    if (projectId !== undefined && !UUID.test(projectId)) {
      throw new BadArgument('`projectId` must be a project UUID, as returned by list_projects.')
    }
    const waitSeconds = optionalNumber(args, 'waitSeconds', { min: 0, max: 300, fallback: 120 })

    const started = await client.startScan({
      url,
      profile,
      ...(projectId ? { projectId } : {}),
    })
    if (!started.ok) return describeFailure(started)

    const scanId = started.scan.id
    const deadline = Date.now() + waitSeconds * 1000

    // The POST already reports a terminal status for a fast scan, so this loop
    // does no work at all in the common case.
    let status = started.scan.status
    while (!TERMINAL.has(status)) {
      if (Date.now() >= deadline) {
        return (
          `Scan ${scanId} of ${url} is still ${status} after ${waitSeconds}s.\n` +
          `The scan is still running — call get_scan with scanId ${scanId} to pick it up.`
        )
      }
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())))

      const polled = await client.getScan(scanId)
      // A transient read failure mid-poll must not throw away an id the caller
      // has no other copy of, so it is reported with the id attached.
      if (!polled.ok) {
        return failure(`${describeFailure(polled).text}\nThe scan may still be running — its id is ${scanId}.`)
      }
      status = polled.scan.status
      if (TERMINAL.has(status)) return formatReport(polled)
    }

    const report = await client.getScan(scanId)
    if (!report.ok) return describeFailure(report)
    return formatReport(report)
  },
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
