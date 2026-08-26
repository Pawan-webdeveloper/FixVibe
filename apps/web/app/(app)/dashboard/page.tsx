/**
 * Every project, its latest score, and whether that score moved.
 *
 * The delta is the reason anyone opens this page twice, and it is deliberately
 * absent when the two scans were produced by different engine versions or scan
 * depths. "Coverage changed" is the truth in that case; a number would blame
 * the site for our deploy.
 */

import Link from 'next/link'
import { listProjectSummaries, type ProjectSummary } from '@darvin/db'
import { getViewer, requireUser } from '@/lib/authz.ts'
import { NewProjectForm } from './new-project-form.tsx'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'

export const metadata = { title: 'Projects' }

export default async function DashboardPage() {
  const user = await requireUser('/dashboard')
  const viewer = await getViewer()
  const summaries = await listProjectSummaries(viewer)

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <LabeledRule
        as="h1"
        label="Projects"
        trailing={`${summaries.length} tracked`}
      />
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <NewProjectForm orgId={user.orgId} />
      </div>

      {summaries.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {summaries.map((summary) => (
            <ProjectRow key={summary.project.id} summary={summary} />
          ))}
        </ul>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="mt-8 border border-line bg-surface p-8 text-center">
      <h2 className="font-medium">No projects yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted text-pretty">
        Add a site above to keep its history, or scan any URL from the home page and save the report
        into a project afterwards.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm link">
        Run a scan
      </Link>
    </div>
  )
}

function ProjectRow({ summary }: { summary: ProjectSummary }) {
  const { project, latest, delta } = summary
  const score = latest?.scores?.overall ?? null

  return (
    <li>
      <Link
        href={`/projects/${project.id}`}
        className="flex items-center gap-4 border border-line px-5 py-4 hover:bg-surface"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{project.name}</p>
          <p className="truncate text-xs text-muted">{project.url}</p>
        </div>

        {score === null ? (
          <span className="label text-muted">
            {latest?.status === 'failed' ? 'Last scan failed' : 'Not scanned yet'}
          </span>
        ) : (
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums">{score}</p>
            <p className="label text-muted tabular-nums">
              {delta === null ? 'coverage changed' : delta === 0 ? 'no change' : delta > 0 ? `+${delta}` : delta}
            </p>
          </div>
        )}
      </Link>
    </li>
  )
}
