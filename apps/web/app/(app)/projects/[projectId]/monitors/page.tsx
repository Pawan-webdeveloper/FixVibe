/**
 * The three things that can be watched, and their switches.
 *
 * Deliberately three fixed monitors rather than a builder. Each is a different
 * question with a different cost, and the useful answers are the same for
 * everyone — a builder would mostly produce configurations nobody wanted and a
 * few that were expensive.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProject, getUserContext, listMonitors, recentEvents, type MonitorType } from '@darvin/db'
import { getViewer, requireUser } from '@/lib/authz.ts'
import { planFor } from '@/lib/plans.ts'
import { MonitorRow } from '@/components/monitors/monitor-row.tsx'
import { UptimeChart } from '@/components/monitors/uptime-chart.tsx'
import { toggleMonitorAction } from './actions.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CATALOGUE: ReadonlyArray<{
  type: MonitorType
  title: string
  description: string
  intervalLabel: string
}> = [
  {
    type: 'uptime',
    title: 'Uptime',
    description:
      'One request a minute. Alerts after two consecutive failures — a single timeout is a blip, not an outage.',
    intervalLabel: 'every minute',
  },
  {
    type: 'domain',
    title: 'Certificate expiry',
    description:
      'Checks the TLS certificate daily and warns at 30, 14, 7, 3 and 1 days. An expired certificate takes the site down for everyone.',
    intervalLabel: 'daily',
  },
  {
    type: 'rescan',
    title: 'Daily re-scan',
    description:
      'Runs the full scan and alerts when the score drops — never when the drop is ours, from a change in what we check.',
    intervalLabel: 'daily',
  },
]

export const metadata = { title: 'Monitors' }

export default async function MonitorsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  if (!UUID.test(projectId)) notFound()

  const user = await requireUser(`/projects/${projectId}/monitors`)
  const viewer = await getViewer()
  const project = await getProject(projectId, viewer)
  if (!project) notFound()

  const plan = planFor((await getUserContext(user.id))?.plan)
  const monitors = await listMonitors(projectId, viewer)
  const byType = new Map(monitors.map((monitor) => [monitor.type, monitor]))

  const uptime = byType.get('uptime')
  const uptimeEvents = uptime ? await recentEvents(uptime.id, viewer) : []

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="border-b border-line pb-5">
        <Link href={`/projects/${projectId}`} className="text-sm text-muted hover:text-ink">
          ← {project.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Monitors</h1>
        <p className="truncate font-mono text-xs text-muted">{project.url}</p>
      </header>

      {plan.monitors === 0 && (
        <p className="mt-6 rounded-lg border border-line bg-surface px-5 py-4 text-sm">
          Monitoring is part of Pro.{' '}
          <Link href="/pricing" className="text-accent">
            See what it includes
          </Link>
          .
        </p>
      )}

      <ul className="mt-6 flex flex-col gap-3">
        {CATALOGUE.map((entry) => (
          <MonitorRow
            key={entry.type}
            type={entry.type}
            title={entry.title}
            description={entry.description}
            intervalLabel={entry.intervalLabel}
            enabled={byType.get(entry.type)?.enabled ?? false}
            lastStatus={byType.get(entry.type)?.lastStatus ?? null}
            onToggle={async (type, enabled) => {
              'use server'
              await toggleMonitorAction(projectId, type, enabled)
            }}
          />
        ))}
      </ul>

      {uptime?.enabled && (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-medium">Uptime</h2>
          <UptimeChart events={uptimeEvents} />
          <p className="mt-3 text-sm text-muted">
            Published at{' '}
            <Link href={`/status/${project.slug}`} className="text-accent">
              /status/{project.slug}
            </Link>{' '}
            — readable without an account.
          </p>
        </section>
      )}
    </div>
  )
}
