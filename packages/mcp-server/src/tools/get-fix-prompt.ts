/**
 * The change list.
 *
 * This is the tool the whole server exists for. Everything else describes a
 * site; this returns a work order an agent can execute — findings grouped by
 * WHERE the change is made, so every edit to one file happens together, with
 * the stack's own conventions filled in.
 *
 * Returned verbatim, never summarised. A truncated work order is worse than
 * none: an agent handed half of it makes half the changes and reports success.
 */

import { describeFailure, requireScanId, type Tool } from './types.ts'

export const getFixPrompt: Tool = {
  name: 'get_fix_prompt',
  description:
    'Get the aggregate fix prompt for a scan: every actionable finding rewritten as one ordered set of ' +
    'changes, grouped by the file or config each belongs in and adapted to the detected framework. ' +
    'This is what to use when the task is to FIX the site rather than to report on it. Requires a plan ' +
    'that includes fix prompts.',
  inputSchema: {
    type: 'object',
    properties: {
      scanId: { type: 'string', description: 'The scan UUID to build the work order from.' },
    },
    required: ['scanId'],
    additionalProperties: false,
  },
  async run(args, { client }) {
    const scanId = requireScanId(args)
    const result = await client.getFixPrompt(scanId)
    if (!result.ok) return describeFailure(result)

    // An empty prompt is a real answer, not a failure: a report of only
    // informational rows has no work order, and returning an empty block would
    // read as one that came back blank.
    if (!result.prompt) {
      return `Scan ${scanId} of ${result.url} has nothing actionable — every finding is informational, so there is no work order.`
    }

    return `Work order for ${result.url} — ${result.issueCount} issue${result.issueCount === 1 ? '' : 's'}.\n\n${result.prompt}`
  },
}
