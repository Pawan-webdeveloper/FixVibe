/**
 * Read a scan back, and the formatter every other tool reuses.
 *
 * The output is text rather than JSON on purpose. A model reading a report has
 * to decide what to do next, and a severity histogram plus the worst few
 * titles gets it there in a fraction of the tokens a serialized report costs —
 * which matters, because a deep scan of a real site produces hundreds.
 * list_findings is the drill-down when it wants the detail.
 */

import type { Finding, ScanReport } from '../client.ts'
import { describeFailure, requireScanId, type Tool } from './types.ts'

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const

export const getScan: Tool = {
  name: 'get_scan',
  description:
    'Read a Darvin scan by id: status, pillar scores, and a severity summary of its findings. ' +
    'Use this to poll a deep scan that was still running, or to re-read a scan found via list_projects. ' +
    'For the findings themselves call list_findings; for the change list call get_fix_prompt.',
  inputSchema: {
    type: 'object',
    properties: {
      scanId: { type: 'string', description: 'The scan UUID returned by run_scan or list_projects.' },
    },
    required: ['scanId'],
    additionalProperties: false,
  },
  async run(args, { client }) {
    const scanId = requireScanId(args)
    const result = await client.getScan(scanId)
    if (!result.ok) return describeFailure(result)
    return formatReport(result)
  },
}

/** Shared with run_scan, so a scan reads the same whoever asked for it. */
export function formatReport(report: ScanReport): string {
  const { scan, scores, findings } = report
  const lines: string[] = []

  lines.push(`Scan ${scan.id} — ${scan.url}`)
  lines.push(`status: ${scan.status} · profile: ${scan.profile} · engine ${scan.engineVersion} · ${scan.checksRun} checks`)

  if (scan.status === 'failed') {
    // The failure reason IS the result here. An SSRF-blocked target or a host
    // that never answered is something the model should report, not retry.
    lines.push(`failed: ${scan.error ?? 'no reason recorded'}`)
    return lines.join('\n')
  }

  if (scan.status === 'queued' || scan.status === 'running') {
    lines.push('')
    lines.push(`Not finished yet. Call get_scan with scanId ${scan.id} again in a few seconds.`)
    return lines.join('\n')
  }

  if (scan.durationMs !== null) lines.push(`took ${(scan.durationMs / 1000).toFixed(1)}s`)

  if (scores) {
    lines.push('')
    lines.push(`overall ${scores['overall']}/100`)
    const pillars = Object.entries(scores).filter(([k]) => k !== 'overall' && k !== 'degraded')
    lines.push(pillars.map(([name, value]) => `  ${name.padEnd(14)} ${value}`).join('\n'))

    // A degraded pillar was only partly measured. Reporting its score without
    // that caveat invites the model to call a gap a pass.
    const degraded = scores['degraded']
    if (Array.isArray(degraded) && degraded.length > 0) {
      lines.push(`  (partly measured, treat as incomplete: ${degraded.join(', ')})`)
    }
  }

  lines.push('')
  lines.push(`${findings.length} findings — ${histogram(findings)}`)

  const worst = findings.filter((f) => f.severity !== 'info').slice(0, 8)
  if (worst.length > 0) {
    lines.push('')
    for (const finding of worst) {
      lines.push(`  [${finding.severity}] ${finding.checkId} — ${finding.title}`)
    }
    const rest = findings.filter((f) => f.severity !== 'info').length - worst.length
    if (rest > 0) lines.push(`  … and ${rest} more. Call list_findings for the full set.`)
  }

  if (report.locked.count > 0) {
    // Named rather than hidden: a plan-limited report is a smaller
    // measurement, not a broken one, and the model should say which it is.
    lines.push('')
    lines.push(`${report.locked.count} findings are listed but not opened on this plan.`)
  }

  if (scan.checkErrors.length > 0) {
    // Our failures, not the site's. A model told "17 of 63 checks could not
    // run" reports a partial audit instead of a clean bill of health.
    lines.push('')
    lines.push(`${scan.checkErrors.length} checks could not run (a Darvin-side failure, not a site issue):`)
    for (const e of scan.checkErrors.slice(0, 5)) lines.push(`  ${e.checkId}: ${e.message}`)
  }

  if (report.fixPromptAvailable && findings.some((f) => f.severity !== 'info')) {
    lines.push('')
    lines.push(`Call get_fix_prompt with scanId ${scan.id} for the change list.`)
  }

  return lines.join('\n')
}

export function histogram(findings: readonly Finding[]): string {
  const counts = new Map<string, number>()
  for (const finding of findings) counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1)
  const parts = SEVERITIES.filter((s) => counts.has(s)).map((s) => `${counts.get(s)} ${s}`)
  return parts.length > 0 ? parts.join(', ') : 'none'
}
