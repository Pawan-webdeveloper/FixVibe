/**
 * FILE: apps/web/src/components/monitors/IncidentList.tsx
 *
 * Renders the incident history for a single monitor detail page.
 * Shows open incidents at the top in red, resolved ones below in grey.
 *
 * Props:
 *   monitorId — the monitor whose incidents to display
 */

/* monitor error — replaced date-fns (not installed) with native Intl/Date APIs,
 * added explicit Incident type import from @scanlyfix/db */

import React, { useEffect, useState } from 'react'
import type { Incident } from '@scanlyfix/db'

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/* monitor error — replaced formatDistanceToNow from date-fns with native Intl API */
function formatDistanceToNow(date: Date): string {
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffDay > 0) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`
  if (diffHr > 0) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`
  if (diffMin > 0) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`
  return 'just now'
}

/* monitor error — replaced format() from date-fns with native Intl.DateTimeFormat */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function statusLabel(statusCode: number | null): string {
  if (!statusCode) return 'Connection error'
  return `HTTP ${statusCode}`
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                       */
/* ------------------------------------------------------------------ */

interface IncidentRowProps {
  incident: Incident
  isOpen: boolean
}

function IncidentRow({ incident, isOpen }: IncidentRowProps) {
  const startedAt = new Date(incident.startedAt)

  return (
    <div
      className={`flex items-start justify-between gap-4 rounded-lg border p-4 ${
        isOpen ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'
      }`}
    >
      <div className="min-w-0 flex-1">
        {/* Status badge */}
        <div className="mb-1 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isOpen
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isOpen ? 'animate-pulse bg-red-500' : 'bg-gray-400'
              }`}
            />
            {isOpen ? 'Ongoing' : 'Resolved'}
          </span>

          {incident.statusCode && (
            <span className="text-xs text-gray-500">
              {statusLabel(incident.statusCode)}
            </span>
          )}
        </div>

        {/* Timestamps */}
        <p className="text-sm text-gray-700">
          Started{' '}
          <span title={formatDate(startedAt)}>
            {formatDistanceToNow(startedAt)}
          </span>
        </p>

        {incident.detail && (
          <p className="mt-1 truncate text-xs text-gray-400">{incident.detail}</p>
        )}
      </div>

      {/* Duration */}
      <div className="shrink-0 text-right">
        {isOpen ? (
          <span className="text-sm font-medium text-red-600">
            {formatDistanceToNow(startedAt)} downtime
          </span>
        ) : incident.durationMs != null ? (
          <span className="text-sm font-medium text-gray-500">
            {formatDuration(incident.durationMs)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main export                                                          */
/* ------------------------------------------------------------------ */

interface IncidentListProps {
  monitorId: string
}

/* monitor error — replaced tRPC hooks with regular fetch since @/lib/trpc
 * does not exist. Uses same polling behavior (30s interval). */
export function IncidentList({ monitorId }: IncidentListProps) {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [openIncident, setOpenIncident] = useState<Incident | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)

  useEffect(() => {
    if (!monitorId) return

    const load = async () => {
      try {
        const [listRes, openRes] = await Promise.all([
          fetch(`/api/monitors/${monitorId}/incidents`),
          fetch(`/api/monitors/${monitorId}/incidents/open`),
        ])
        if (!listRes.ok || !openRes.ok) throw new Error('Failed to load')
        const listData = await listRes.json()
        const openData = await openRes.json()
        setIncidents(listData.incidents ?? [])
        setOpenIncident(openData.incident ?? null)
        setIsError(false)
      } catch {
        setIsError(true)
      } finally {
        setIsLoading(false)
      }
    }

    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [monitorId])

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <p className="text-sm text-red-500">
        Failed to load incidents. Try refreshing.
      </p>
    )
  }

  if (incidents.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 py-12 text-center">
        <p className="text-sm text-gray-400">No incidents recorded. All good!</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Incident History</h3>
        <span className="text-xs text-gray-400">{incidents.length} incidents</span>
      </div>

      {incidents.map((incident: Incident) => (
        <IncidentRow
          key={incident.id}
          incident={incident}
          isOpen={openIncident?.id === incident.id}
        />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Banner: shown at top of monitor detail when currently down          */
/* ------------------------------------------------------------------ */

export function IncidentBanner({ monitorId }: { monitorId: string }) {
  const [openIncident, setOpenIncident] = useState<Incident | null>(null)

  useEffect(() => {
    if (!monitorId) return
    fetch(`/api/monitors/${monitorId}/incidents/open`)
      .then((r) => r.json())
      .then((d) => setOpenIncident(d.incident ?? null))
      .catch(() => null)
  }, [monitorId])

  if (!openIncident) return null

  return (
    <div className="flex items-center gap-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 border border-red-200">
      <span className="h-2 w-2 animate-pulse rounded-full bg-red-500 shrink-0" />
      <span>
        Monitor has been down since{' '}
        <strong>
          {formatDistanceToNow(new Date(openIncident.startedAt))}
        </strong>
        {openIncident.statusCode ? ` — HTTP ${openIncident.statusCode}` : ''}
      </span>
    </div>
  )
}
