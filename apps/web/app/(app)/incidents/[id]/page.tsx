/*
 * Internal incident detail page.
 *
 * One row from `incidents`, plus the full updates timeline underneath,
 * plus the form to post a new update. Owner-only — the route looks up
 * the incident, joins to its project, and refuses with 404 if the
 * viewer is not the owner.
 *
 * Pure server component except the form (which posts via fetch). The
 * timeline reuses the public <IncidentUpdatesTimeline> so what the
 * owner sees matches what customers see — no drift.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import {
  db,
  getIncident,
  incidentUpdateStatusLabel,
  listIncidentUpdatesInternal,
  monitors,
  parseStatus,
  projects,
} from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'
import { IncidentUpdateForm } from '@/components/incidents/incident-update-form'

interface Props {
  params: Promise<{ id: string }>
}

function formatDateTime(date: Date): string {
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

function badgeClass(
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved',
): string {
  switch (status) {
    case 'investigating':
      return 'bg-red-50 text-red-700'
    case 'identified':
      return 'bg-amber-50 text-amber-700'
    case 'monitoring':
      return 'bg-blue-50 text-blue-700'
    case 'resolved':
      return 'bg-emerald-50 text-emerald-700'
  }
}

function shortName(email: string | null): string {
  if (!email) return 'Unknown user'
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

export default async function IncidentDetailPage({ params }: Props) {
  const { id } = await params

  const viewer = await getViewer()
  if (viewer.kind !== 'user') notFound()

  // Look up the incident via the auth-gated helper. Returns null for both
  // "no such id" and "not yours" — the page renders the same 404 either way.
  const incident = await getIncident(id, viewer)
  if (!incident) notFound()

  const updates = await listIncidentUpdatesInternal(id, viewer)

  // Pull the project's slug so the on-call can preview the public timeline.
  // Join incidents → monitors → projects in one query; cheaper than two
  // round trips and we already have a Viewer check above.
  const projectRow = (
    await db
      .select({
        id: projects.id,
        slug: projects.slug,
        name: projects.name,
      })
      .from(monitors)
      .innerJoin(projects, eq(projects.id, monitors.projectId))
      .where(eq(monitors.id, incident.monitorId))
      .limit(1)
  )[0]

  const isOpen = incident.resolvedAt === null

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6">
        <Link href="/monitors" className="text-xs text-gray-500 hover:text-gray-900">
          ← Back to Monitors
        </Link>
      </div>

      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
              isOpen ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {isOpen && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500"
              />
            )}
            {isOpen ? 'Ongoing' : 'Resolved'}
          </span>
          {incident.statusCode && (
            <span className="text-xs text-gray-400">
              HTTP {incident.statusCode}
            </span>
          )}
          {projectRow && (
            <Link
              href={`/status/${projectRow.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs text-blue-600 hover:text-blue-800"
            >
              View public status page ↗
            </Link>
          )}
        </div>

        <h1 className="mt-2 text-xl font-semibold text-gray-900">
          Incident {incident.id.slice(0, 8)}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {formatDateTime(incident.startedAt)}
          {incident.resolvedAt && (
            <> — {formatDateTime(incident.resolvedAt)}</>
          )}
          {isOpen
            ? <span className="ml-2 font-medium text-red-500">ongoing</span>
            : incident.durationMs != null
              ? <span className="ml-2">({formatDuration(incident.durationMs)})</span>
              : null}
        </p>
        {incident.detail && (
          <p className="mt-2 truncate text-xs text-gray-400">{incident.detail}</p>
        )}
      </header>

      {/* Post an update — visible to all viewers on the incident's project
          today. The same auth rule used by ack/notes applies (project
          ownership). */}
      <section
        aria-labelledby="post-update-heading"
        className="mb-8 rounded-lg border border-gray-100 bg-white p-5"
      >
        <h2 id="post-update-heading" className="mb-3 text-sm font-medium text-gray-700">
          Post an update
        </h2>
        <IncidentUpdateForm incidentId={incident.id} />
      </section>

      {/* Timeline */}
      <section aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="mb-3 text-sm font-medium text-gray-700">
          Timeline ({updates.length})
        </h2>
        {updates.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
            No updates posted yet — add the first one above.
          </p>
        ) : (
          <ol
            data-testid="internal-incident-updates"
            className="relative space-y-5 border-l border-gray-200 pl-5"
          >
            {updates.map((update) => (
              <li
                key={update.id}
                data-testid={`internal-incident-update-${update.status}`}
                className="relative"
              >
                <span
                  aria-hidden="true"
                  className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-gray-300 ring-4 ring-white"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(parseStatus(update.status))}`}
                  >
                    {incidentUpdateStatusLabel(parseStatus(update.status))}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatDateTime(update.createdAt)}
                  </span>
                  <span className="text-xs text-gray-400">
                    by {shortName(update.creatorEmail)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-gray-700">
                  {update.message}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
