/**
 * The console overview: what is wrong across every site this account watches.
 *
 * The page is built around one honest constraint — every figure on it comes
 * from `getDashboardSummary`, which reads the LATEST completed scan per site.
 * Nothing here is a placeholder and nothing is derived from a number shown
 * somewhere else on the page, so the severity bar, the tiles and the pillar
 * breakdown cannot disagree with each other.
 *
 * Layout follows the shape a console wants rather than the shape a report
 * wants: the headline count and its severity split first, the sites and the
 * scan action beside it, then the worst individual findings, then the
 * breakdown by pillar. A reader who only looks at the top of this page should
 * still learn the one thing that matters.
 *
 * The pillar breakdown is where the engine's 63 checks become legible. They
 * are grouped six ways — security, SEO, AI answers, performance,
 * accessibility, compliance — because that is how the scoring model groups
 * them, and a dashboard that invented its own grouping would be reporting a
 * different product than the report page does.
 */

import Link from 'next/link'
import {
  getDashboardSummary,
  listProjectSummaries,
  listRecentScansForUser,
  type DashboardFinding,
  type DashboardSummary,
  type ProjectSummary,
  type Scan,
} from '@scanlyfix/db'
import type { Category, Severity } from '@scanlyfix/checks'
import { getViewer, requireUser } from '@/lib/authz.ts'
import { ScanForm } from '@/components/scan/scan-form.tsx'
import { NewProjectForm } from './new-project-form.tsx'
import { Icon } from '@/components/console/icons.tsx'

export const metadata = { title: 'Dashboard' }

/** How many checks a scan runs. Stated so the tile is not a magic number. */
const CHECKS_PER_SCAN = 63

/** Worst-first, matching SEVERITY_ORDER in the engine. */
const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  info: 'info',
}

/** Tailwind cannot see a class built at runtime, so both halves are literal. */
const SEVERITY_BG: Record<Severity, string> = {
  critical: 'bg-sev-critical',
  high: 'bg-sev-high',
  medium: 'bg-sev-medium',
  low: 'bg-sev-low',
  info: 'bg-sev-info',
}

const SEVERITY_TEXT: Record<Severity, string> = {
  critical: 'text-sev-critical',
  high: 'text-sev-high',
  medium: 'text-sev-medium',
  low: 'text-sev-low',
  info: 'text-sev-info',
}

/** The six pillars, in the order the report page leads with them. */
const PILLARS: readonly { key: Category; label: string }[] = [
  { key: 'security', label: 'Security' },
  { key: 'seo', label: 'SEO' },
  { key: 'aeo', label: 'AI answers' },
  { key: 'performance', label: 'Performance' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'compliance', label: 'Compliance' },
]

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

/** Band colour for a 0–100 score, on the same 90/70 cut the report uses. */
function scoreTone(score: number): string {
  if (score >= 90) return 'text-emerald-600 dark:text-emerald-400'
  if (score >= 70) return 'text-amber-600 dark:text-amber-400'
  return 'text-sev-high'
}

export default async function DashboardPage() {
  const user = await requireUser('/dashboard')
  const viewer = await getViewer()
  const [summary, projects, recentScans] = await Promise.all([
    getDashboardSummary(viewer),
    listProjectSummaries(viewer),
    listRecentScansForUser(viewer),
  ])

  const scores = [
    ...projects.map((p) => p.latest?.scores?.overall),
    ...recentScans.map((s) => s.scores?.overall),
  ].filter((n): n is number => typeof n === 'number')
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null

  return (
    <div className="console flex min-h-dvh flex-col bg-c-bg text-c-ink">
      <TopBar email={user.email} sites={projects.length} />

      <div className="flex flex-col gap-8 px-5 py-6 sm:px-8 sm:py-8">
        <ScanPanel />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <IssueSummary summary={summary} />
          <MonitoringPanel sites={projects.length} />
        </div>

        <NeedsAttention findings={summary.needsAttention} scanned={summary.sitesScanned} />

        <AssetSummary
          sites={projects.length}
          scans={recentScans.length}
          scanned={summary.sitesScanned}
          avg={avg}
        />

        <IssueTypes summary={summary} />

        <Sites projects={projects} orgId={user.orgId} />

        {recentScans.length > 0 && <RecentScans scans={recentScans} />}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Chrome                                                                     */
/* -------------------------------------------------------------------------- */

function TopBar({ email, sites }: { email: string; sites: number }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-c-line bg-c-card px-5 sm:px-8">
      <div className="min-w-0 pl-12 lg:pl-0">
        <p className="truncate text-[15px] font-semibold">All sites</p>
        <p className="console-num truncate text-[12px] text-c-muted">
          {sites === 0 ? 'nothing tracked yet' : `${sites} tracked`}
        </p>
      </div>

      <div className="flex-1" />

      {/*
        The search field is not wired to anything yet, so it is not rendered as
        an input a person can type into and get nothing back from. It is the
        link to the place search will live, which today is the site list below.
      */}
      <Link
        href="#sites"
        aria-label="Find a site"
        className="grid h-9 w-9 place-items-center rounded-lg text-c-muted transition-colors hover:bg-c-soft hover:text-c-ink"
      >
        <Icon name="search" />
      </Link>
      {/*
        No "Docs" link, unlike the design this borrows from: there is no docs
        site to send anyone to yet, and a chrome button that 404s is worse than
        one that is absent. Pricing is the one public page that explains what a
        scan covers, so that is what sits here until docs exist.
      */}
      <Link
        href="/pricing"
        className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-c-muted transition-colors hover:bg-c-soft hover:text-c-ink sm:flex"
      >
        <Icon name="book" size={16} />
        Plans
      </Link>
      <Link
        href="/settings/billing"
        aria-label="Settings"
        className="grid h-9 w-9 place-items-center rounded-lg text-c-muted transition-colors hover:bg-c-soft hover:text-c-ink"
      >
        <Icon name="settings" />
      </Link>
      <span
        title={email}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-c-brand text-[13px] font-semibold text-c-brand-ink"
      >
        {email.slice(0, 1).toUpperCase()}
      </span>
    </header>
  )
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      {(title || action) && (
        <div className="mb-3 flex items-end justify-between gap-4">
          {title && <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>}
          {action}
        </div>
      )}
      <div className="rounded-xl border border-c-line bg-c-card">{children}</div>
    </section>
  )
}

function ScanPanel() {
  return (
    <Card title="Scan a site" action={<Pill>{CHECKS_PER_SCAN} checks per scan</Pill>}>
      <div className="p-5">
        {/* restore: this is where a signed-out visitor lands after signing in
            from a scan, so it reclaims the URL they typed before. */}
        <div className="max-w-2xl">
          <ScanForm restore tone="console" />
        </div>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-c-muted">
          {PILLARS.map((pillar) => (
            <li key={pillar.key} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-c-brand/60" />
              {pillar.label}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-c-line bg-c-card px-2.5 py-1 text-[11.5px] font-medium text-c-muted">
      {children}
    </span>
  )
}

function IssueSummary({ summary }: { summary: DashboardSummary }) {
  const { open, openTotal } = summary
  const present = SEVERITIES.filter((s) => open[s] > 0)

  return (
    <Card title="Issue summary">
      <div className="p-5">
        {/*
          The stacked bar is widths in percent of the total, so it always fills
          the track exactly. With no findings it renders one flat neutral bar
          rather than an empty box — "nothing found" is a result, not a gap.
        */}
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-c-soft">
          {openTotal === 0 ? (
            <span className="h-full w-full bg-c-line" />
          ) : (
            present.map((severity) => (
              <span
                key={severity}
                className={`h-full ${SEVERITY_BG[severity]}`}
                style={{ width: `${(open[severity] / openTotal) * 100}%` }}
              />
            ))
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <p className="flex items-baseline gap-2">
            <span className="console-num text-4xl font-semibold">{openTotal}</span>
            <span className="text-[14px] text-c-muted">
              open {openTotal === 1 ? 'finding' : 'findings'}
            </span>
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {SEVERITIES.map((severity) => (
              <li key={severity} className="flex items-center gap-2 text-[13px]">
                <span
                  aria-hidden="true"
                  className={`h-2.5 w-2.5 rounded-[3px] ${SEVERITY_BG[severity]}`}
                />
                <span className="console-num font-semibold">{open[severity]}</span>
                <span className="text-c-muted">{SEVERITY_LABEL[severity]}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-2 border-t border-c-line sm:grid-cols-4">
        <MiniStat icon="feed" label="Open" value={summary.openTotal} hint="awaiting a fix" />
        <MiniStat icon="shield" label="Fixed" value={summary.fixed} hint="confirmed gone" divider />
        <MiniStat icon="bell" label="Ignored" value={summary.ignored} hint="muted by you" divider />
        <MiniStat
          icon="globe"
          label="Sites affected"
          value={summary.sitesAffected}
          hint={`of ${summary.sitesScanned} scanned`}
          divider
        />
      </div>
    </Card>
  )
}

function MiniStat({
  icon,
  label,
  value,
  hint,
  divider = false,
}: {
  icon: React.ComponentProps<typeof Icon>['name']
  label: string
  value: number
  hint: string
  divider?: boolean
}) {
  return (
    <div className={`px-5 py-4 ${divider ? 'sm:border-l sm:border-c-line' : ''}`}>
      <p className="flex items-center gap-2 text-[12.5px] font-medium text-c-muted">
        <Icon name={icon} size={15} />
        {label}
      </p>
      <p className="console-num mt-1.5 text-2xl font-semibold">{value}</p>
      <p className="text-[12px] text-c-muted">{hint}</p>
    </div>
  )
}

function MonitoringPanel({ sites }: { sites: number }) {
  return (
    <Card title="Monitoring">
      <div className="flex min-h-45 flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-full bg-c-soft text-c-muted">
          <Icon name="uptime" size={22} />
        </span>
        <p className="text-[13.5px] text-c-muted text-pretty">
          {sites === 0
            ? 'Nobody is watching a site yet.'
            : 'Scheduled re-scans and uptime checks are set per site.'}
        </p>
        {sites === 0 ? (
          <p className="text-[12.5px] text-c-muted">Add a site below to start watching it.</p>
        ) : (
          <Link href="#sites" className="text-[13px] font-medium text-c-brand hover:underline">
            Set up monitoring →
          </Link>
        )}
      </div>
    </Card>
  )
}

function NeedsAttention({ findings, scanned }: { findings: DashboardFinding[]; scanned: number }) {
  return (
    <Card
      title="Needs attention"
      action={
        findings.length > 0 ? (
          <Link href="#sites" className="text-[13px] font-medium text-c-brand hover:underline">
            Open the sites →
          </Link>
        ) : null
      }
    >
      {findings.length === 0 ? (
        <p className="p-6 text-center text-[13.5px] text-c-muted text-pretty">
          {scanned === 0
            ? 'Nothing scanned yet — run a scan above and the worst findings land here.'
            : 'No critical or high findings are open. That is the good outcome.'}
        </p>
      ) : (
        <ul className="grid gap-px bg-c-line sm:grid-cols-2 lg:grid-cols-3">
          {findings.map((finding) => (
            <li key={finding.id} className="bg-c-card">
              <Link
                href={`/scan/${finding.scanId}`}
                className="flex h-full flex-col gap-2 p-5 transition-colors hover:bg-c-soft"
              >
                <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide">
                  <span className={SEVERITY_TEXT[finding.severity]}>{finding.severity}</span>
                  <span aria-hidden="true" className="text-c-line">
                    ·
                  </span>
                  <span className="font-normal normal-case tracking-normal text-c-muted">
                    {finding.category === 'aeo' ? 'AI answers' : finding.category}
                  </span>
                </p>
                <p className="text-[14.5px] font-medium leading-snug text-pretty">{finding.title}</p>
                <p className="mt-auto truncate text-[12.5px] text-c-muted">{finding.host}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function AssetSummary({
  sites,
  scans,
  scanned,
  avg,
}: {
  sites: number
  scans: number
  scanned: number
  avg: number | null
}) {
  return (
    <section>
      <h2 className="mb-3 text-[17px] font-semibold tracking-tight">Asset summary</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <BigStat icon="globe" label="Domains" value={String(sites)} hint="tracked as projects" />
        <BigStat icon="search" label="Sites scanned" value={String(scanned)} hint="with a result" />
        <BigStat icon="feed" label="Ad-hoc scans" value={String(scans)} hint="not in a project" />
        <BigStat
          icon="shield"
          label="Average score"
          value={avg === null ? '—' : String(avg)}
          hint={avg === null ? 'no scans yet' : 'across every scan'}
          {...(avg === null ? {} : { tone: scoreTone(avg) })}
        />
      </div>
    </section>
  )
}

function BigStat({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentProps<typeof Icon>['name']
  label: string
  value: string
  hint: string
  tone?: string
}) {
  return (
    <div className="rounded-xl border border-c-line bg-c-card p-5">
      <p className="flex items-center gap-2 text-[12.5px] font-medium text-c-muted">
        <Icon name={icon} size={15} />
        {label}
      </p>
      <p className={`console-num mt-2 text-3xl font-semibold ${tone ?? ''}`}>{value}</p>
      <p className="mt-0.5 text-[12px] text-c-muted">{hint}</p>
    </div>
  )
}

/**
 * The engine's own grouping, made visible.
 *
 * Bars are scaled against the LARGEST pillar rather than against the total, so
 * the shape of the distribution stays readable when one pillar dominates —
 * which it usually does, because security has the most checks.
 */
function IssueTypes({ summary }: { summary: DashboardSummary }) {
  const peak = Math.max(1, ...PILLARS.map((p) => summary.byCategory[p.key]))

  return (
    <Card title="Issue types" action={<Pill>open findings by pillar</Pill>}>
      <ul className="flex flex-col gap-3.5 p-5">
        {PILLARS.map((pillar) => {
          const n = summary.byCategory[pillar.key]
          return (
            <li key={pillar.key} className="flex items-center gap-4">
              <span className="w-28 shrink-0 text-[13.5px] font-medium sm:w-36">{pillar.label}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-c-soft">
                <span
                  className={`block h-full rounded-full ${n > 0 ? 'bg-c-brand' : 'bg-transparent'}`}
                  style={{ width: `${(n / peak) * 100}%` }}
                />
              </span>
              <span className="console-num w-8 shrink-0 text-right text-[13.5px] font-semibold">
                {n}
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function Sites({ projects, orgId }: { projects: ProjectSummary[]; orgId: string }) {
  return (
    <section id="sites" className="scroll-mt-20">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-[17px] font-semibold tracking-tight">Domains</h2>
        <NewProjectForm orgId={orgId} />
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-c-line bg-c-card p-8 text-center">
          <p className="text-[15px] font-medium">No domains tracked yet</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13.5px] text-c-muted text-pretty">
            Add a site to keep its history and watch its score move, or scan any URL above and file
            that report into a domain afterwards.
          </p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-c-line bg-c-card">
          {projects.map((summary, index) => (
            <ProjectRow key={summary.project.id} summary={summary} first={index === 0} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ProjectRow({ summary, first }: { summary: ProjectSummary; first: boolean }) {
  const { project, latest, delta } = summary
  const score = latest?.scores?.overall ?? null
  const failed = latest?.status === 'failed'

  return (
    <li className={first ? '' : 'border-t border-c-line'}>
      <Link
        href={`/projects/${project.id}`}
        className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-c-soft"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-c-soft text-c-muted">
          <Icon name="globe" size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium">{project.name}</span>
          <span className="block truncate text-[12.5px] text-c-muted">{project.url}</span>
        </span>
        {score !== null ? (
          <span className="flex shrink-0 items-center gap-4">
            {/* Hidden on the narrowest screens: the delta is the least useful
                thing in this row, and keeping it there crushed the host name
                it sits beside down to "mock-inte…". */}
            <span className="hidden sm:inline">
              <DeltaTag delta={delta} />
            </span>
            <span className={`console-num text-2xl font-semibold ${scoreTone(score)}`}>{score}</span>
          </span>
        ) : (
          <span className="shrink-0 text-[12.5px] text-c-muted">
            {failed ? 'last scan failed' : 'not scanned yet'}
          </span>
        )}
      </Link>
    </li>
  )
}

/** Which way the score moved since last time, or why there is no number. */
function DeltaTag({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-[12px] text-c-muted">coverage changed</span>
  if (delta === 0) return <span className="text-[12px] text-c-muted">no change</span>
  const up = delta > 0
  return (
    <span
      className={`console-num text-[12.5px] font-semibold ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-sev-high'}`}
    >
      {up ? `▲ +${delta}` : `▼ ${delta}`}
    </span>
  )
}

function RecentScans({ scans }: { scans: Scan[] }) {
  return (
    <Card title="Recent scans" action={<Pill>not filed under a domain</Pill>}>
      <ul>
        {scans.map((scan, index) => {
          const score = scan.scores?.overall ?? null
          return (
            <li key={scan.id} className={index === 0 ? '' : 'border-t border-c-line'}>
              <Link
                href={`/scan/${scan.id}`}
                className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-c-soft"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{hostOf(scan.url)}</span>
                  <span className="console-num block truncate text-[12px] text-c-muted">
                    {stamp(scan.createdAt)}
                  </span>
                </span>
                {score !== null ? (
                  <span className={`console-num text-xl font-semibold ${scoreTone(score)}`}>
                    {score}
                  </span>
                ) : (
                  <span className="text-[12.5px] text-c-muted">
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
        })}
      </ul>
    </Card>
  )
}
