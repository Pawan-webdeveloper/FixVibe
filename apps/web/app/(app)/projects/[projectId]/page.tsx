/**
 * One project: its scan history, and a way to run another.
 *
 * This is the page a paying user opens every week, so it answers one question
 * first — did anything change — before offering any detail.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import type { Metadata } from 'next'
import { getProject, listScansForProject, type Scan } from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'
import { scoreColor } from '@/components/scan/score-ring.tsx'
import { rescanAction } from './actions.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function stamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/**
 * Shared by generateMetadata and the page, so one render is one query.
 *
 * Next calls both for the same request; without `cache` the project would be
 * fetched twice on a page that already measures over a second.
 */
const loadProject = cache(async (projectId: string) => {
  if (!UUID.test(projectId)) return null
  const viewer = await getViewer()
  return getProject(projectId, viewer)
})

/**
 * The project's own name in the tab, because somebody tracking several sites
 * has several of these open and "Darvin" on every one of them tells them
 * nothing about which is which.
 *
 * A project the viewer cannot see gets the neutral title rather than a 404
 * here — the page itself calls notFound(), and metadata is the wrong place to
 * decide that. It also must not confirm the id exists to somebody guessing.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>
}): Promise<Metadata> {
  const { projectId } = await params
  const project = await loadProject(projectId)
  return {
    title: project?.name ?? 'Project',
    // Signed-in pages are already excluded in robots.txt; this is the copy of
    // that rule which travels with the page itself.
    robots: { index: false, follow: false },
  }
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ quota?: string }>
}) {
  const { projectId } = await params
  const { quota } = await searchParams

  const project = await loadProject(projectId)
  if (!project) notFound()

  const viewer = await getViewer()
  const scans = await listScansForProject(projectId, viewer)
  const latest = scans[0]

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div className="min-w-0">
          <Link href="/dashboard" className="text-sm text-muted hover:text-ink">
            ← Projects
          </Link>
          <h1 className="mt-1 truncate text-2xl font-semibold">{project.name}</h1>
          <p className="truncate font-mono text-xs text-muted">{project.url}</p>
          <p className="label mt-2 text-muted">
            {project.verifiedDomain ? (
              <>
                Domain verified ·{' '}
                <Link href={`/projects/${project.id}/verify`} className="link">
                  manage
                </Link>
              </>
            ) : (
              <Link href={`/projects/${project.id}/verify`} className="link">
                Verify this domain to unlock the backend checks →
              </Link>
            )}
          </p>
        </div>

        {/*
          Two submits, one action, same as the onboarding form. The depth is a
          button rather than a select because there are exactly two of them and
          a select would need client JavaScript to say what each one costs.
        */}
        <form action={rescanAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="projectId" value={project.id} />
          <button
            type="submit"
            name="profile"
            value="fast"
            className="label inline-flex h-11 items-center border border-ink bg-ink px-6 text-canvas
                       transition-colors duration-150 hover:bg-transparent hover:text-ink"
          >
            Scan now
          </button>
          <button
            type="submit"
            name="profile"
            value="deep"
            title="Crawls the site's own links, renders it in a real browser and reads field Core Web Vitals. Takes about a minute."
            className="label inline-flex h-11 items-center border border-line px-6
                       transition-colors duration-150 hover:bg-surface"
          >
            Deep scan
          </button>
        </form>
      </header>

      {quota === 'spent' && (
        <p role="alert" className="mt-6 border border-line bg-surface px-4 py-3 text-sm">
          This month&apos;s scan allowance is spent. It resets on the first of next month, or{' '}
          <Link href="/pricing" className="link">
            Pro raises it
          </Link>
          .
        </p>
      )}

      {scans.length === 0 ? (
        <p className="mt-8 border border-line bg-surface p-6 text-sm text-muted">
          No scans yet. Run one to start this project&apos;s history.
        </p>
      ) : (
        <>
          {latest && <Sparkline scans={scans} />}

          <h2 className="mt-10 mb-3 text-sm font-medium">History</h2>
          <ul className="flex flex-col gap-2">
            {scans.map((scan) => (
              <HistoryRow key={scan.id} scan={scan} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * A bar per scan, oldest on the left. No chart library — this is a flex row of
 * divs, and a dependency for it would cost more than it renders.
 */
function Sparkline({ scans }: { scans: Scan[] }) {
  const points = [...scans].reverse().filter((s) => s.scores !== null)
  if (points.length < 2) return null

  return (
    <section className="mt-8" aria-label="Score over time">
      <div className="flex h-24 items-end gap-1">
        {points.map((scan) => {
          const score = scan.scores?.overall ?? 0
          return (
            <div
              key={scan.id}
              title={`${score}/100 · ${stamp(scan.createdAt)}`}
              style={{ height: `${Math.max(4, score)}%`, backgroundColor: scoreColor(score) }}
              className="min-w-1.5 flex-1"
            />
          )
        })}
      </div>
      <p className="mt-2 text-xs text-muted">
        {points.length} scans · oldest on the left
      </p>
    </section>
  )
}

function HistoryRow({ scan }: { scan: Scan }) {
  const score = scan.scores?.overall ?? null

  return (
    <li>
      <Link
        href={`/scan/${scan.id}`}
        className="flex items-center gap-4 border border-line px-4 py-3 hover:bg-surface"
      >
        <span className="flex-1 font-mono text-xs text-muted">{stamp(scan.createdAt)}</span>

        {scan.status === 'failed' && <span className="text-sm text-danger">failed</span>}
        {(scan.status === 'queued' || scan.status === 'running') && (
          // Both, because a deep scan sits in 'queued' until a worker takes it
          // and showing nothing for that window reads as a scan that vanished.
          <span className="text-sm text-muted">{scan.status === 'queued' ? 'queued…' : 'running…'}</span>
        )}

        {score !== null && (
          <span className="text-lg font-semibold tabular-nums" style={{ color: scoreColor(score) }}>
            {score}
          </span>
        )}
      </Link>
    </li>
  )
}
