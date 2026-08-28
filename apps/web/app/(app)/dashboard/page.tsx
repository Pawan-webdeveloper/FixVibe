/**
 * Every project, its latest score, and whether that score moved.
 *
 * The delta is the reason anyone opens this page twice, and it is deliberately
 * absent when the two scans were produced by different engine versions or scan
 * depths. "Coverage changed" is the truth in that case; a number would blame
 * the site for our deploy.
 *
 * The page leads with the one action that matters — scan a URL — then a strip
 * of the numbers that summarise the account, then the projects and the
 * account's own ad-hoc scans. A score is never a bare figure: it carries the
 * same colour band the report and the CLI use, so 91 reads as healthy and 40
 * reads as a problem without anyone having to remember which way is up.
 */

import Link from 'next/link'
import { listProjectSummaries, listRecentScansForUser, type ProjectSummary, type Scan } from '@scanlyfix/db'
import { getViewer, requireUser } from '@/lib/authz.ts'
import { NewProjectForm } from './new-project-form.tsx'
import { ScanForm } from '@/components/scan/scan-form.tsx'
import { LabeledRule } from '@/components/ui/labeled-rule.tsx'
import { scoreColor } from '@/components/scan/score-ring.tsx'

export const metadata = { title: 'Projects' }

/** The pillars the engine actually reports, named so the hero states its worth. */
const PILLARS = ['Security', 'SEO', 'AI answers', 'Performance', 'Accessibility', 'Compliance'] as const

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

/** The one-word band, matching the 90 / 70 cut the colour uses. */
function bandLabel(score: number): string {
  if (score >= 90) return 'good'
  if (score >= 70) return 'fair'
  return 'poor'
}

export default async function DashboardPage() {
  const user = await requireUser('/dashboard')
  const viewer = await getViewer()
  const [summaries, recentScans] = await Promise.all([
    listProjectSummaries(viewer),
    listRecentScansForUser(viewer),
  ])

  // Every score we have loaded — one per project's latest scan, plus the
  // ad-hoc ones — collapsed into the two figures the strip shows. Computed
  // here so the tiles never claim a number the rows below cannot back up.
  const scores = [
    ...summaries.map((s) => s.latest?.scores?.overall),
    ...recentScans.map((s) => s.scores?.overall),
  ].filter((n): n is number => typeof n === 'number')
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  const hasData = summaries.length > 0 || recentScans.length > 0

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
        <LabeledRule as="h1" label="Scan a site" trailing="paste a URL" />
        <div className="mt-6 border border-line p-6 sm:p-8">
          <div className="max-w-xl">
            {/* restore: this is where a signed-out visitor lands after signing
                in from a scan, so it reclaims the URL they typed before. */}
            <ScanForm restore />
          </div>
          <p className="mt-6 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted">
            <span className="label text-ink">Checks</span>
            {PILLARS.map((pillar) => (
              <span key={pillar} className="flex items-center gap-2.5">
                <span aria-hidden="true" className="text-line">
                  ·
                </span>
                {pillar}
              </span>
            ))}
          </p>
        </div>
      </section>

      {hasData && (
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat value={String(summaries.length)} label="Projects" hint="tracked" />
          <Stat value={String(recentScans.length)} label="Recent scans" hint="ad-hoc" />
          <Stat
            value={avg === null ? '—' : String(avg)}
            label="Average score"
            hint={avg === null ? 'no scans yet' : 'across scans'}
            {...(avg === null ? {} : { color: scoreColor(avg) })}
          />
        </div>
      )}

      <section className="mt-14">
        <LabeledRule as="h2" label="Projects" trailing={`${summaries.length} tracked`} />
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <NewProjectForm orgId={user.orgId} />
        </div>

        {summaries.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="mt-6 flex flex-col gap-2.5">
            {summaries.map((summary) => (
              <ProjectRow key={summary.project.id} summary={summary} />
            ))}
          </ul>
        )}
      </section>

      {recentScans.length > 0 && (
        <section className="mt-14">
          <LabeledRule as="h2" label="Recent scans" trailing="not saved to a project" />
          <ul className="mt-6 flex flex-col gap-2.5">
            {recentScans.map((scan) => (
              <ScanRow key={scan.id} scan={scan} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** One figure from the overview strip: a big number over a field-name label. */
function Stat({
  value,
  label,
  hint,
  color,
}: {
  value: string
  label: string
  hint?: string
  color?: string
}) {
  return (
    <div className="border border-line bg-surface px-5 py-4">
      <p className="text-3xl font-semibold tabular-nums" {...(color ? { style: { color } } : {})}>
        {value}
      </p>
      <p className="label mt-1 text-muted">
        {label}
        {hint ? ` · ${hint}` : ''}
      </p>
    </div>
  )
}

/** The score, coloured by band, with the denominator that gives it a scale. */
function Score({ value, big = false }: { value: number; big?: boolean }) {
  return (
    <div className="flex items-baseline gap-1 tabular-nums">
      <span
        className={`font-semibold ${big ? 'text-3xl' : 'text-2xl'}`}
        style={{ color: scoreColor(value) }}
      >
        {value}
      </span>
      <span className="text-sm text-muted">/100</span>
    </div>
  )
}

/** Which way the score moved since last time, or why there is no number. */
function DeltaTag({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="label text-muted">coverage changed</span>
  if (delta === 0) return <span className="label text-muted">no change</span>
  const up = delta > 0
  return (
    <span className={`label tabular-nums ${up ? 'text-good' : 'text-critical'}`}>
      {up ? `▲ +${delta}` : `▼ ${delta}`}
    </span>
  )
}

function EmptyState() {
  return (
    <div className="mt-6 border border-line bg-surface p-10 text-center">
      <h3 className="text-lg font-medium">No projects yet</h3>
      <p className="mx-auto mt-2 max-w-md text-[15px] text-muted text-pretty">
        Add a site above to keep its history and watch its score over time, or scan any URL from the
        field at the top and save that report into a project afterwards.
      </p>
    </div>
  )
}

function ProjectRow({ summary }: { summary: ProjectSummary }) {
  const { project, latest, delta } = summary
  const score = latest?.scores?.overall ?? null
  const failed = latest?.status === 'failed'

  return (
    <li>
      <Link
        href={`/projects/${project.id}`}
        className="group flex items-center gap-4 border border-line border-l-4 px-5 py-4 transition-colors hover:bg-surface"
        {...(score !== null ? { style: { borderLeftColor: scoreColor(score) } } : {})}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-medium">{project.name}</p>
          <p className="mt-0.5 truncate font-mono text-sm text-muted">{project.url}</p>
        </div>

        {score !== null ? (
          <div className="flex shrink-0 items-center gap-5">
            <DeltaTag delta={delta} />
            <Score value={score} big />
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-4">
            <span className="label text-muted">{failed ? 'last scan failed' : 'not scanned yet'}</span>
            <span className="label text-accent transition-colors group-hover:text-ink">Scan now →</span>
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
        className="group flex items-center gap-4 border border-line border-l-4 px-5 py-3.5 transition-colors hover:bg-surface"
        {...(score !== null ? { style: { borderLeftColor: scoreColor(score) } } : {})}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-medium">{hostOf(scan.url)}</p>
          <p className="mt-0.5 truncate font-mono text-sm text-muted">{stamp(scan.createdAt)}</p>
        </div>

        {score !== null ? (
          <div className="flex shrink-0 items-center gap-3">
            <span className="label hidden sm:inline" style={{ color: scoreColor(score) }}>
              {bandLabel(score)}
            </span>
            <Score value={score} />
          </div>
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
