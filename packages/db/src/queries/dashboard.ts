/**
 * The one read behind the console's overview.
 *
 * Same rule as every other module in queries/: it takes a Viewer and there is
 * no unfiltered variant. Drizzle connects as the database owner, so Postgres
 * row-level security never applies and this file is the access control.
 *
 * ## What "current" means here
 *
 * A dashboard that summed every finding ever recorded would climb forever —
 * re-scanning a site would double its own issue count, and fixing something
 * would never make the number go down. So the summary is built from the
 * LATEST completed scan per target URL, which is the only set that answers
 * "what is wrong with my sites right now".
 *
 * `DISTINCT ON (url)` does that selection in Postgres rather than in JS,
 * because the alternative is loading every scan the account has ever run in
 * order to throw nearly all of them away.
 *
 * ## Why a raw statement
 *
 * Drizzle's query builder has no `DISTINCT ON`, and the shape wanted here —
 * pick a row per group, then aggregate its children — is one statement in SQL
 * and three round trips without it. The parameters are bound, never
 * interpolated, and the module stays inside queries/ so it is still auditable
 * in the one place authorization is meant to live.
 */

import { sql } from 'drizzle-orm'
import { db } from '../client.ts'
import type { Category, Severity } from '@scanlyfix/checks'
import type { Viewer } from './viewer.ts'

/** Every severity, always present, so a caller never has to guard a lookup. */
export type SeverityCounts = Record<Severity, number>
/** Every pillar, always present, for the same reason. */
export type CategoryCounts = Record<Category, number>

export interface DashboardFinding {
  id: string
  scanId: string
  checkId: string
  title: string
  severity: Severity
  category: Category
  /** Host of the scanned URL — what names the finding on a card. */
  host: string
}

export interface DashboardSummary {
  /** Open findings only, split by severity. The stacked bar reads this. */
  open: SeverityCounts
  /** Total open findings — the headline figure. */
  openTotal: number
  /** Lifecycle counts across the same current scans. */
  fixed: number
  ignored: number
  /** Open findings per pillar, which is what "issue types" ranks. */
  byCategory: CategoryCounts
  /** Sites whose latest scan has at least one open finding. */
  sitesAffected: number
  /** Distinct sites with a completed scan behind them. */
  sitesScanned: number
  /** The worst few, for the cards that say what to do next. */
  needsAttention: DashboardFinding[]
}

const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const CATEGORIES: readonly Category[] = [
  'security',
  'seo',
  'aeo',
  'performance',
  'accessibility',
  'compliance',
]

function zeroSeverities(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
}

function zeroCategories(): CategoryCounts {
  return { security: 0, seo: 0, aeo: 0, performance: 0, accessibility: 0, compliance: 0 }
}

/** An account with nothing scanned yet. Shaped like a real answer, all zeros. */
export function emptyDashboardSummary(): DashboardSummary {
  return {
    open: zeroSeverities(),
    openTotal: 0,
    fixed: 0,
    ignored: 0,
    byCategory: zeroCategories(),
    sitesAffected: 0,
    sitesScanned: 0,
    needsAttention: [],
  }
}

/**
 * Rows come back as text from the driver for counts (Postgres `bigint`), so
 * every number crosses through Number() rather than being trusted as one.
 */
function toCount(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Narrow an untrusted string to a Severity, or null. */
function asSeverity(value: unknown): Severity | null {
  return SEVERITIES.includes(value as Severity) ? (value as Severity) : null
}

/** Narrow an untrusted string to a Category, or null. */
function asCategory(value: unknown): Category | null {
  return CATEGORIES.includes(value as Category) ? (value as Category) : null
}

/**
 * `db.execute` on the node-postgres driver resolves to a pg `QueryResult`, not
 * to the rows — reading it as an array yields nothing and every tile silently
 * shows zero. One helper so that mistake cannot be made per call site.
 */
function rowsOf(result: unknown): Record<string, unknown>[] {
  const rows = (result as { rows?: unknown }).rows
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * Scans that count toward the summary: the newest completed scan for each URL
 * the viewer can see, which is their own scans plus every scan filed under a
 * project they own.
 *
 * Kept as one fragment so the three statements below cannot drift apart on
 * which scans they consider — a mismatch there would show a severity bar that
 * disagrees with the tiles beside it.
 */
function currentScans(userId: string) {
  return sql`
    select distinct on (s.url) s.id, s.url
      from scans s
      left join projects p on p.id = s.project_id
     where s.status = 'done'
       and (s.requested_by = ${userId} or p.owner_id = ${userId})
     order by s.url, s.created_at desc
  `
}

export async function getDashboardSummary(viewer: Viewer): Promise<DashboardSummary> {
  if (viewer.kind !== 'user') return emptyDashboardSummary()
  const userId = viewer.userId

  const [severityRows, categoryRows, attentionRows] = await Promise.all([
    /*
     * One pass over the current scans' findings, grouped by both axes the
     * tiles need. Status is included rather than filtered so `fixed` and
     * `ignored` come from the same scan set as `open` — counting them in a
     * second query would let the two disagree if a scan landed between them.
     */
    db.execute(sql`
      with current as (${currentScans(userId)})
      select f.status::text as status,
             f.severity::text as severity,
             count(*)::int as n,
             count(distinct f.scan_id)::int as scans
        from findings f
        join current c on c.id = f.scan_id
       group by 1, 2
    `),

    db.execute(sql`
      with current as (${currentScans(userId)})
      select f.category::text as category, count(*)::int as n
        from findings f
        join current c on c.id = f.scan_id
       where f.status = 'open'
       group by 1
    `),

    /*
     * The worst handful, worst-first. `severity` is a Postgres enum declared
     * critical-first, so ordering by the column already ranks it correctly —
     * no CASE ladder, and no risk of that ladder drifting from SEVERITY_ORDER.
     */
    db.execute(sql`
      with current as (${currentScans(userId)})
      select f.id, f.scan_id, f.check_id, f.title,
             f.severity::text as severity, f.category::text as category,
             c.url
        from findings f
        join current c on c.id = f.scan_id
       where f.status = 'open'
         and f.severity in ('critical', 'high')
       order by f.severity, f.created_at desc
       limit 3
    `),
  ])

  const summary = emptyDashboardSummary()

  for (const row of rowsOf(severityRows)) {
    const n = toCount(row['n'])
    if (row['status'] === 'fixed') summary.fixed += n
    else if (row['status'] === 'ignored') summary.ignored += n
    else if (row['status'] === 'open') {
      const severity = asSeverity(row['severity'])
      if (!severity) continue
      summary.open[severity] += n
      summary.openTotal += n
    }
  }

  for (const row of rowsOf(categoryRows)) {
    const category = asCategory(row['category'])
    if (category) summary.byCategory[category] += toCount(row['n'])
  }

  summary.needsAttention = rowsOf(attentionRows).flatMap((row) => {
    const severity = asSeverity(row['severity'])
    const category = asCategory(row['category'])
    if (!severity || !category) return []
    return [
      {
        id: String(row['id']),
        scanId: String(row['scan_id']),
        checkId: String(row['check_id']),
        title: String(row['title']),
        severity,
        category,
        host: hostOf(String(row['url'])),
      },
    ]
  })

  /*
   * Site counts come from the scan set itself rather than from the findings
   * join, so a clean site still counts as scanned. A site with zero findings
   * would otherwise vanish from "sites scanned" for being healthy.
   */
  const siteRows = await db.execute(sql`
    with current as (${currentScans(userId)})
    select count(*)::int as scanned,
           count(*) filter (
             where exists (
               select 1 from findings f
                where f.scan_id = current.id and f.status = 'open'
             )
           )::int as affected
      from current
  `)

  const site = rowsOf(siteRows)[0]
  summary.sitesScanned = toCount(site?.['scanned'])
  summary.sitesAffected = toCount(site?.['affected'])

  return summary
}
