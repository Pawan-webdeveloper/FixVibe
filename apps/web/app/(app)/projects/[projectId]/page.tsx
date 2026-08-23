/**
 * One project: its scan history, and a way to run another.
 *
 * This is the page a paying user opens every week, so it answers one question
 * first — did anything change — before offering any detail.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProject, listScansForProject, type Scan } from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'
import { scoreColor } from '@/components/scan/score-ring.tsx'
import { rescanAction } from './actions.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function stamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  if (!UUID.test(projectId)) notFound()

  const viewer = await getViewer()
  const project = await getProject(projectId, viewer)
  if (!project) notFound()

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
        </div>

        <form action={rescanAction}>
          <input type="hidden" name="projectId" value={project.id} />
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
          >
            Scan now
          </button>
        </form>
      </header>

      {scans.length === 0 ? (
        <p className="mt-8 rounded-lg border border-line bg-surface p-6 text-sm text-muted">
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
              className="min-w-1.5 flex-1 rounded-sm"
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
        className="flex items-center gap-4 rounded-lg border border-line px-4 py-3 hover:bg-surface"
      >
        <span className="flex-1 font-mono text-xs text-muted">{stamp(scan.createdAt)}</span>

        {scan.status === 'failed' && <span className="text-sm text-danger">failed</span>}
        {scan.status === 'running' && <span className="text-sm text-muted">running…</span>}

        {score !== null && (
          <span className="text-lg font-semibold tabular-nums" style={{ color: scoreColor(score) }}>
            {score}
          </span>
        )}
      </Link>
    </li>
  )
}
