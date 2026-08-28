/**
 * Every project, its latest score, and whether that score moved.
 *
 * The delta is the reason anyone opens this page twice, and it is deliberately
 * absent when the two scans were produced by different engine versions or scan
 * depths. "Coverage changed" is the truth in that case; a number would blame
 * the site for our deploy.
 *
 * Below the projects: the account's own ad-hoc scans — the ones run from the
 * home page without being saved into a project. They were attributed to the
 * account but shown nowhere, so a signed-in scan felt like it disappeared. This
 * is where it lives now.
 */

import Link from 'next/link'
import { listProjectSummaries, listRecentScansForUser, type ProjectSummary, type Scan } from '@scanlyfix/db'
import { getViewer, requireUser } from '@/lib/authz.ts'
import { NewProjectForm } from './new-project-form.tsx'
import { ScanForm } from '@/components/scan/scan-form.tsx'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'

export const metadata = { title: 'Projects' }

/** UTC, because a report link is shared across time zones. */
function stamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export default async function DashboardPage() {
  const user = await requireUser('/dashboard')
  const viewer = await getViewer()
  const [summaries, recentScans] = await Promise.all([
    listProjectSummaries(viewer),
    listRecentScansForUser(viewer),
  ])

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      {/*
        Scan a URL without leaving the app. Reached from "Scan another site" on
        a report, so a signed-in person is not sent back to the marketing page
        just to run one. The form is the same useScanSubmit as the hero — same
        validation, same destination — and the (app) layout's auth provider is
        what lets it read the signed-in state.
      */}
      <section>
        <LabeledRule as="h1" label="Scan a site" trailing="a URL, not an account" />
        <div className="mt-6 max-w-xl">
          <ScanForm />
        </div>
      </section>

      <div className="mt-16">
        <LabeledRule as="h2" label="Projects" trailing={`${summaries.length} tracked`} />
      </div>
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

      {recentScans.length > 0 && (
        <section className="mt-16">
          <LabeledRule as="h2" label="Recent scans" trailing="not saved to a project" />
          <ul className="mt-6 flex flex-col gap-2">
            {recentScans.map((scan) => (
              <ScanRow key={scan.id} scan={scan} />
            ))}
          </ul>
        </section>
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

function ScanRow({ scan }: { scan: Scan }) {
  const score = scan.scores?.overall ?? null

  return (
    <li>
      <Link
        href={`/scan/${scan.id}`}
        className="flex items-center gap-4 border border-line px-5 py-3.5 hover:bg-surface"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{hostOf(scan.url)}</p>
          <p className="truncate font-mono text-xs text-muted">{stamp(scan.createdAt)}</p>
        </div>

        {score !== null ? (
          <span className="text-xl font-semibold tabular-nums">{score}</span>
        ) : (
          <span className="label text-muted">
            {scan.status === 'failed'
              ? 'failed'
              : scan.status === 'queued' || scan.status === 'running'
                ? `${scan.status}…`
                : '—'}
          </span>
        )}
      </Link>
    </li>
  )
}
