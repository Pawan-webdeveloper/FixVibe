/**
 * What this key can see.
 *
 * The discovery tool, and the one a session usually starts with: an agent
 * holding only an API key has no way to name a project, and both of the other
 * things a project is good for — attaching a scan to a history, and unlocking
 * the two backend checks on a verified domain — need its id.
 */

import { describeFailure, type Tool } from './types.ts'

export const listProjects: Tool = {
  name: 'list_projects',
  description:
    'List the Darvin projects this API key can see, with each one\'s latest scan and score. ' +
    'Start here when you need a projectId, or to find an existing scan instead of running a new one.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  async run(_args, { client }) {
    const result = await client.listProjects()
    if (!result.ok) return describeFailure(result)

    if (result.projects.length === 0) {
      return 'This account has no projects yet. run_scan works without one — a scan with no projectId is still recorded against the account.'
    }

    const lines = [`${result.projects.length} project${result.projects.length === 1 ? '' : 's'}:`]

    for (const project of result.projects) {
      lines.push('')
      lines.push(`${project.name} — ${project.url}`)
      lines.push(`  projectId: ${project.id}`)
      // Stated for every project, because it decides what a scan can measure.
      // An unverified project is missing two checks, and a model that does not
      // know that will report their absence as a pass.
      lines.push(
        project.verifiedDomain
          ? '  domain verified — backend checks (Supabase RLS, Firebase rules) will run'
          : '  domain not verified — the two backend checks will be skipped',
      )

      if (!project.latestScan) {
        lines.push('  no scans yet')
        continue
      }

      const { latestScan: scan } = project
      const overall = scan.overall === null ? 'no score' : `overall ${scan.overall}/100`
      // Only printed when it is real. `overallDelta` is null whenever the two
      // scans are not comparable — a different engine version or depth means
      // the ruler changed, not the site — and a coerced 0 would say "no
      // change" about a comparison that was never made.
      const delta = project.overallDelta === null ? '' : ` (${project.overallDelta >= 0 ? '+' : ''}${project.overallDelta} since the previous scan)`
      lines.push(`  latest: ${scan.id} · ${scan.status} · ${scan.profile} · ${overall}${delta} · ${scan.createdAt.slice(0, 10)}`)
    }

    return lines.join('\n')
  },
}
