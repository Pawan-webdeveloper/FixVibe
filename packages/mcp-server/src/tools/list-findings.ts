/**
 * The drill-down.
 *
 * get_scan gives a model enough to decide; this gives it enough to act. The
 * split exists because a deep scan of a real site produces hundreds of
 * findings, and pouring all of them into a context window on the off chance
 * one is wanted is how a tool becomes something a model avoids calling.
 *
 * `remediation` is included and `fixPrompt` is not. The per-finding prompt is
 * the same text the aggregate one is built from, so returning both would send
 * every work order twice — get_fix_prompt is where that belongs.
 */

import { describeFailure, optionalEnum, optionalNumber, requireScanId, type Tool } from './types.ts'

const CATEGORIES = ['security', 'seo', 'aeo', 'performance', 'accessibility', 'compliance', 'all'] as const
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info', 'all'] as const

/** Ranked, so "minSeverity: high" means high AND critical rather than high alone. */
const RANK = ['critical', 'high', 'medium', 'low', 'info']

export const listFindings: Tool = {
  name: 'list_findings',
  description:
    'List a scan\'s findings in full — description, evidence and remediation — optionally filtered by ' +
    'pillar or minimum severity. Findings come back worst-first. Use this after get_scan when you need ' +
    'the detail behind a specific pillar or severity.',
  inputSchema: {
    type: 'object',
    properties: {
      scanId: { type: 'string', description: 'The scan UUID.' },
      category: {
        type: 'string',
        enum: [...CATEGORIES],
        description: 'Restrict to one pillar. Default "all".',
      },
      minSeverity: {
        type: 'string',
        enum: [...SEVERITIES],
        description: 'Only findings at least this severe. Default "all".',
      },
      limit: { type: 'number', description: 'Maximum findings to return. Default 25, max 100.' },
    },
    required: ['scanId'],
    additionalProperties: false,
  },
  async run(args, { client }) {
    const scanId = requireScanId(args)
    const category = optionalEnum(args, 'category', CATEGORIES, 'all')
    const minSeverity = optionalEnum(args, 'minSeverity', SEVERITIES, 'all')
    const limit = optionalNumber(args, 'limit', { min: 1, max: 100, fallback: 25 })

    const result = await client.getScan(scanId)
    if (!result.ok) return describeFailure(result)

    const ceiling = minSeverity === 'all' ? RANK.length : RANK.indexOf(minSeverity)
    const matching = result.findings.filter(
      (f) => (category === 'all' || f.category === category) && RANK.indexOf(f.severity) <= ceiling,
    )

    if (matching.length === 0) {
      const filters = [category === 'all' ? null : `category ${category}`, minSeverity === 'all' ? null : `severity ${minSeverity} or worse`]
        .filter(Boolean)
        .join(', ')
      // Distinguished from an empty scan, because "nothing matched your filter"
      // and "the site is clean" are opposite conclusions.
      return filters
        ? `No findings match ${filters} in scan ${scanId}. The scan has ${result.findings.length} findings in total.`
        : `Scan ${scanId} has no findings.`
    }

    const shown = matching.slice(0, limit)
    const lines = [`${matching.length} matching findings in scan ${scanId} (showing ${shown.length}), worst first:`]

    for (const finding of shown) {
      lines.push('')
      lines.push(`[${finding.severity}] ${finding.category} · ${finding.checkId}`)
      lines.push(finding.title)
      if (finding.locked) {
        // The shape of the report is public; its contents are not. Saying so
        // stops the model reporting a locked finding as one with no detail.
        lines.push('  (not opened on this plan — upgrade to read the detail)')
        continue
      }
      if (finding.description) lines.push(`  what: ${finding.description}`)
      if (finding.remediation) lines.push(`  fix:  ${finding.remediation}`)
      if (finding.evidence && Object.keys(finding.evidence).length > 0) {
        lines.push(`  evidence: ${JSON.stringify(finding.evidence)}`)
      }
    }

    if (matching.length > shown.length) {
      lines.push('')
      lines.push(`${matching.length - shown.length} more match. Raise \`limit\` or narrow the filters.`)
    }

    return lines.join('\n')
  },
}
