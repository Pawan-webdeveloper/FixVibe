/*
 * One component (one enabled monitor) on the public status page.
 *
 * The status page renders one of these per enabled monitor — uptime
 * components get the full strip + incidents treatment (with the
 * Statuspage-style updates timeline under each incident); domain,
 * web_vitals and rescan components render as compact info cards.
 *
 * Pure server component — no client JS.
 */

import { UptimeStrip } from './uptime-strip'
import { IncidentUpdatesTimeline, type IncidentUpdateView } from './incident-updates-timeline'

type ComponentStatus = 'ok' | 'failed' | 'unknown'
type MonitorType = 'uptime' | 'domain' | 'web_vitals' | 'rescan'

export interface PublicIncidentWithUpdates {
  startedAt: Date
  resolvedAt: Date | null
  durationMs: number | null
  statusCode: number | null
  detail: string | null
  updates: ReadonlyArray<IncidentUpdateView>
}

export interface PublicComponentCardProps {
  id: string
  type: MonitorType
  name: string
  currentStatus: ComponentStatus
  lastCheckedAt: Date | null
  uptimePercent: number | null
  dailyBuckets: Array<{ date: string; ok: boolean; total: number }>
  recentIncidents: ReadonlyArray<PublicIncidentWithUpdates>
  maintenance: {
    description: string
    reason: string | null
  } | null
}

function dotClass(status: ComponentStatus): string {
  switch (status) {
    case 'ok':
      return 'bg-emerald-500'
    case 'failed':
      return 'animate-pulse bg-red-500'
    case 'unknown':
      return 'bg-gray-300'
  }
}

function timeAgo(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
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

export function ComponentCard(component: PublicComponentCardProps) {
  const isUptime = component.type === 'uptime'

  return (
    <section
      data-testid={`component-${component.type}`}
      className="rounded-lg border border-gray-100 bg-white p-6"
    >
      {/* Header row: dot + name + last checked */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(component.currentStatus)}`}
          />
          <h2 className="truncate text-base font-semibold text-gray-900">
            {component.name}
          </h2>
        </div>
        {component.lastCheckedAt && (
          <span className="shrink-0 text-xs text-gray-400">
            Checked {timeAgo(component.lastCheckedAt)}
          </span>
        )}
      </div>

      {/* Maintenance banner — per-component, not project-wide */}
      {component.maintenance && (
        <div
          role="status"
          data-testid="component-maintenance-banner"
          className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
        >
          <span aria-hidden="true" className="mt-0.5 text-amber-500">
            🔧
          </span>
          <div>
            <p className="text-sm font-semibold text-amber-700">
              Scheduled maintenance
            </p>
            <p className="mt-0.5 text-sm text-amber-700/80">
              {component.maintenance.description}
              {component.maintenance.reason && (
                <span className="text-amber-700/60">
                  {' '}
                  — {component.maintenance.reason}
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Uptime: full strip + 90-day % + incidents */}
      {isUptime && (
        <>
          <div className="mt-5">
            <UptimeStrip buckets={component.dailyBuckets} />
          </div>

          {component.uptimePercent !== null && (
            <p className="mt-3 text-sm text-gray-500">
              <span className="font-semibold tabular-nums text-gray-900">
                {component.uptimePercent.toFixed(2)}%
              </span>{' '}
              uptime over the last 90 days
            </p>
          )}

          {component.recentIncidents.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-4 text-sm font-medium text-gray-700">
                Recent incidents
              </h3>
              <div className="space-y-8">
                {component.recentIncidents.map((incident, i) => (
                  <IncidentBlock key={i} incident={incident} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Non-uptime: compact info card. Today these components don't have
          incidents or daily buckets, but the architecture is ready — when
          domain/web_vitals/rescan grow their own event streams, the same
          shape renders them in the same place. */}
      {!isUptime && (
        <p className="mt-3 text-sm text-gray-500">
          {component.currentStatus === 'ok'
            ? 'Operational'
            : component.currentStatus === 'failed'
              ? 'Reporting issues'
              : 'Awaiting first check'}
        </p>
      )}
    </section>
  )
}

/**
 * One incident: meta row (status badge + timestamps + duration) and
 * the Statuspage-style updates timeline underneath. Newest update on top.
 */
function IncidentBlock({ incident }: { incident: PublicIncidentWithUpdates }) {
  const isOpen = incident.resolvedAt === null

  return (
    <article
      data-testid="public-incident"
      className="rounded-lg border border-gray-100 p-4"
    >
      {/* Meta row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                isOpen
                  ? 'bg-red-50 text-red-600'
                  : 'bg-gray-100 text-gray-500'
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
          </div>
          <p className="mt-1 text-sm text-gray-700">
            {formatDateTime(incident.startedAt)}
            {incident.resolvedAt && (
              <> — {formatDateTime(incident.resolvedAt)}</>
            )}
          </p>
          {incident.detail && (
            <p className="mt-0.5 truncate text-xs text-gray-400">
              {incident.detail}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right text-sm text-gray-500">
          {isOpen
            ? <span className="font-medium text-red-500">ongoing</span>
            : incident.durationMs != null
              ? formatDuration(incident.durationMs)
              : null}
        </div>
      </div>

      {/* Updates timeline */}
      {incident.updates.length > 0 && (
        <div className="mt-5">
          <IncidentUpdatesTimeline updates={incident.updates} />
        </div>
      )}
    </article>
  )
}
