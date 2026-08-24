/**
 * The report. The page the whole product exists to produce, and the one that
 * gets pasted into other people's Slack channels.
 *
 * Server-rendered end to end: nothing here needs state except the copy button,
 * which is its own client component. Read through getScanForViewer with an
 * anonymous viewer — an anonymous scan is public by design, and a scan that
 * belongs to a project comes back null and renders as not found, which is the
 * correct answer to "does this exist" from someone not entitled to know.
 */

import { cache } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { buildFixPrompt } from '@darvin/checks'
import { getScanForViewer, type ScanWithFindings, type Viewer } from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'
import { claimScanAction } from './actions.ts'
import { ScoreRing } from '@/components/scan/score-ring.tsx'
import { PillarScores } from '@/components/scan/pillar-scores.tsx'
import { FindingsList } from '@/components/scan/findings-list.tsx'
import { FixPromptDialog } from '@/components/scan/fix-prompt-dialog.tsx'
import type { FindingView } from '@/components/scan/finding-card.tsx'

/** Postgres rejects a malformed uuid with an error, so filter before querying. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Shared between generateMetadata and the page so one render is one query.
 *
 * The REAL viewer is passed, not a hardcoded anonymous one. An anonymous scan
 * comes back for anybody either way — that is the shareable report — but a scan
 * that belongs to a project must come back for its owner, who reaches it from
 * their own history. Hardcoding anonymous here would 404 people on their own
 * scans.
 */
const loadScan = cache(async (scanId: string, viewer: Viewer) => {
  if (!UUID.test(scanId)) return null
  return getScanForViewer(scanId, viewer)
})

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** UTC rather than a locale format: this URL is shared across time zones. */
function stamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ scanId: string }>
}): Promise<Metadata> {
  const { scanId } = await params
  const scan = await loadScan(scanId, await getViewer())
  if (!scan) return { title: 'Scan not found' }

  const host = hostOf(scan.url)
  const score = scan.scores?.overall
  return {
    title: score === undefined ? `Scan of ${host}` : `${host} scored ${score}/100`,
    description:
      scan.status === 'done'
        ? `Security and SEO findings for ${host}, measured by Darvin.`
        : `Darvin could not complete a scan of ${host}.`,
  }
}

export default async function ScanPage({ params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params
  const viewer = await getViewer()
  const scan = await loadScan(scanId, viewer)
  if (!scan) notFound()

  const host = hostOf(scan.url)
  const claimable = scan.projectId === null && scan.requestedBy === null

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-5">
        <div className="min-w-0">
          <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
            darvin
          </Link>
          <h1 className="mt-1 truncate font-mono text-xl">{host}</h1>
        </div>
        <Link href="/" className="text-sm text-accent">
          Scan another site
        </Link>
      </header>

      {scan.status === 'failed' && <FailedScan url={scan.url} error={scan.error} at={scan.createdAt} />}

      {(scan.status === 'queued' || scan.status === 'running') && <RunningScan />}

      {scan.status === 'done' && scan.scores && (
        <>
          <section className="flex flex-col items-center gap-8 py-8 sm:flex-row sm:items-center">
            <ScoreRing score={scan.scores.overall} />
            <div className="w-full flex-1">
              <PillarScores scores={scan.scores} />
            </div>
          </section>

          <ScanFacts
            finalUrl={scan.contextMeta?.finalUrl ?? scan.url}
            status={scan.contextMeta?.status ?? null}
            redirects={scan.contextMeta?.redirectChain.length ?? 0}
            checksRun={scan.checksRun}
            engineVersion={scan.engineVersion}
            durationMs={scan.durationMs}
            at={scan.createdAt}
          />

          {scan.checkErrors.length > 0 && <CheckErrors errors={scan.checkErrors} />}

          {claimable && <SaveReport scanId={scan.id} host={host} signedIn={viewer.kind === 'user'} />}

          <AggregateFixPrompt scan={scan} />

          <div className="mt-10">
            <FindingsList findings={scan.findings as FindingView[]} />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * A refused or unreachable target is a legitimate outcome, not an error page.
 * The visitor is told what was attempted and what came back, because "Refusing
 * to scan a private address" is information, and a generic failure screen
 * throws it away.
 */
function FailedScan({ url, error, at }: { url: string; error: string | null; at: Date }) {
  return (
    <section className="my-10 rounded-lg border border-line bg-surface p-6">
      <h2 className="text-lg font-semibold">This scan could not be completed</h2>
      <p className="mt-2 text-sm text-muted">
        Darvin tried to read <code className="font-mono">{url}</code> at {stamp(at)} and stopped.
      </p>
      {error && (
        <p className="mt-3 rounded-md border border-line bg-canvas px-3 py-2 font-mono text-sm">{error}</p>
      )}
      <p className="mt-4 text-sm text-muted">
        If the address was a typo, correct it and try again. If the site is behind a login or blocks
        automated requests, Darvin cannot read it — it only ever reads what a browser would.
      </p>
      <Link href="/" className="mt-4 inline-block text-sm text-accent">
        Try another address
      </Link>
    </section>
  )
}

/**
 * Unreachable while scans run inline. It is written now because Phase 5 moves
 * them onto a queue, and the branch that is missing on the day you need it
 * costs an afternoon.
 */
function RunningScan() {
  return (
    <section className="my-10 rounded-lg border border-line bg-surface p-6">
      <h2 className="text-lg font-semibold">Still scanning</h2>
      <p className="mt-2 text-sm text-muted">
        This scan is in progress. Refresh in a few seconds.
      </p>
    </section>
  )
}

function ScanFacts({
  finalUrl,
  status,
  redirects,
  checksRun,
  engineVersion,
  durationMs,
  at,
}: {
  finalUrl: string
  status: number | null
  redirects: number
  checksRun: number
  engineVersion: string
  durationMs: number | null
  at: Date
}) {
  const facts: Array<[string, string]> = [
    ['Final URL', finalUrl],
    ['HTTP', status === null ? '—' : String(status)],
    ['Redirects', String(redirects)],
    ['Checks run', String(checksRun)],
    ['Duration', durationMs === null ? '—' : `${durationMs} ms`],
    ['Scanned', stamp(at)],
    // Recorded on the page, not just in the row: two reports of the same site
    // are only comparable when this matches, and a reader cannot know that
    // unless it is visible.
    ['Engine', engineVersion],
  ]

  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-line pt-5 text-sm sm:grid-cols-2">
      {facts.map(([key, value]) => (
        <div key={key} className="flex gap-3">
          <dt className="w-24 shrink-0 text-muted">{key}</dt>
          <dd className="min-w-0 truncate font-mono text-xs leading-5">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Our failures, shown rather than hidden behind a score that looks complete. */
function CheckErrors({ errors }: { errors: Array<{ checkId: string; message: string }> }) {
  return (
    <section className="mt-6 rounded-lg border border-line px-4 py-3">
      <h2 className="text-sm font-medium">
        {errors.length} check{errors.length === 1 ? '' : 's'} could not complete
      </h2>
      <p className="mt-1 text-sm text-muted">
        The pillars they belong to are marked provisional above. This is a problem on our side, not
        with the site.
      </p>
      <ul className="mt-2 flex flex-col gap-1 font-mono text-xs text-muted">
        {errors.map((e) => (
          <li key={e.checkId}>
            {e.checkId} — {e.message}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The conversion moment, placed directly under the score where the reader has
 * just seen something worth keeping.
 */
function SaveReport({ scanId, host, signedIn }: { scanId: string; host: string; signedIn: boolean }) {
  return (
    <section className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-5 py-4">
      <div>
        <p className="text-sm font-medium">Keep this report</p>
        <p className="text-sm text-muted">
          Track {host} over time and see what changes between scans.
        </p>
      </div>

      {signedIn ? (
        <form action={claimScanAction}>
          <input type="hidden" name="scanId" value={scanId} />
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
          >
            Save as a project
          </button>
        </form>
      ) : (
        <Link
          href={`/login?next=${encodeURIComponent(`/scan/${scanId}`)}`}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
        >
          Sign in to save
        </Link>
      )}
    </section>
  )
}

/**
 * Built on read rather than stored, so a report gets today's prompt: the
 * grouping and the stack-specific locations improve as the engine does, and a
 * prompt frozen at scan time would keep handing out last month's advice.
 */
function AggregateFixPrompt({ scan }: { scan: ScanWithFindings }) {
  const prompt = buildFixPrompt(scan.findings, {
    url: scan.contextMeta?.finalUrl ?? scan.url,
    stack: {
      framework: scan.contextMeta?.framework ?? null,
      // Absent on scans recorded before platform detection existed; null is the
      // honest value there, and the prompt falls back to generic guidance.
      platform: scan.contextMeta?.platform ?? null,
    },
  })

  // Empty when nothing is actionable — a report of only informational rows has
  // no work order, and an empty box would imply otherwise.
  if (!prompt) return null

  const actionable = scan.findings.filter((f) => f.severity !== 'info').length
  return <FixPromptDialog prompt={prompt} issueCount={actionable} />
}
