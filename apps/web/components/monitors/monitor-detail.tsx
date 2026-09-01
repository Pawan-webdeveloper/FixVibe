'use client'

import { useEffect, useState, useCallback } from 'react'
import { StatusDot } from './status-dot'
import { UptimeBadge } from './uptime-badge'
import { ResponseTimeChart } from './response-time-chart'
import { IncidentsList } from './incidents-list'

interface LogEntry {
  latencyMs: number | null
  ok: boolean
  ts: string
}

interface Incident {
  id: string
  startedAt: string
  resolvedAt: string | null
  durationMs: number | null
  statusCode: number | null
  detail: string | null
}

interface UptimeData {
  uptimePercent: number
  total: number
  up: number
  down: number
}

interface MonitorData {
  id: string
  projectName: string
  projectUrl: string
  lastStatus: 'up' | 'down' | null /* uptime error — use 'up'/'down' to match DB status values */
  lastRunAt: string | null
  intervalS: number
  enabled: boolean
}

interface MonitorDetailProps {
  monitor: MonitorData
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export function MonitorDetail({ monitor }: MonitorDetailProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [uptime, setUptime] = useState<UptimeData | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [period, setPeriod] = useState<'24h' | '7d' | '30d'>('7d')
  /* uptime error — added error states to surface fetch failures instead of silently swallowing */
  const [logsError, setLogsError] = useState<string | null>(null)
  const [uptimeError, setUptimeError] = useState<string | null>(null)
  const [incidentsError, setIncidentsError] = useState<string | null>(null)

  const loadLogs = useCallback(() => {
    fetch(`/api/monitors/${monitor.id}/logs`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load logs')
        return r.json()
      })
      .then((d) => { setLogs(d.logs ?? []); setLogsError(null) })
      .catch((e: unknown) => setLogsError(e instanceof Error ? e.message : 'Failed to load logs'))
  }, [monitor.id])

  const loadUptime = useCallback(() => {
    fetch(`/api/monitors/${monitor.id}/uptime?period=${period}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load uptime')
        return r.json()
      })
      .then((d) => { setUptime(d); setUptimeError(null) })
      .catch((e: unknown) => setUptimeError(e instanceof Error ? e.message : 'Failed to load uptime'))
  }, [monitor.id, period])

  const loadIncidents = useCallback(() => {
    fetch(`/api/monitors/${monitor.id}/incidents`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load incidents')
        return r.json()
      })
      .then((d) => { setIncidents(d.incidents ?? []); setIncidentsError(null) })
      .catch((e: unknown) => setIncidentsError(e instanceof Error ? e.message : 'Failed to load incidents'))
  }, [monitor.id])

  // Initial load + 30s polling for logs
  useEffect(() => {
    loadLogs()
    const id = setInterval(loadLogs, 30_000)
    return () => clearInterval(id)
  }, [loadLogs])

  // Uptime reloads when period changes
  useEffect(() => { loadUptime() }, [loadUptime])

  // Incidents load once
  useEffect(() => { loadIncidents() }, [loadIncidents])

  const avgLatency =
    logs.length > 0
      ? Math.round(logs.reduce((s, l) => s + (l.latencyMs ?? 0), 0) / logs.length)
      : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <StatusDot status={monitor.lastStatus} size="md" />
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{monitor.projectName}</h1>
            <p className="text-sm text-gray-400">{monitor.projectUrl}</p>
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            monitor.lastStatus === 'up'
              ? 'bg-emerald-50 text-emerald-700'
              : monitor.lastStatus === 'down'
                ? 'bg-red-50 text-red-700'
                : 'bg-gray-100 text-gray-500'
          }`}
        >
          {monitor.lastStatus === 'up' ? 'UP' : monitor.lastStatus === 'down' ? 'DOWN' : 'PENDING'}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-100 bg-white px-4 py-3">
          <p className="text-xs text-gray-400">Uptime (7d)</p>
          <div className="mt-1">
            {uptime ? <UptimeBadge percent={uptime.uptimePercent} /> : <span className="text-sm text-gray-300">—</span>}
          </div>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white px-4 py-3">
          <p className="text-xs text-gray-400">Avg response</p>
          <p className="mt-1 text-sm font-medium text-gray-700">
            {avgLatency !== null ? `${avgLatency}ms` : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white px-4 py-3">
          <p className="text-xs text-gray-400">Last check</p>
          <p className="mt-1 text-sm font-medium text-gray-700">
            {monitor.lastRunAt ? timeAgo(monitor.lastRunAt) : 'never'}
          </p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white px-4 py-3">
          <p className="text-xs text-gray-400">Interval</p>
          <p className="mt-1 text-sm font-medium text-gray-700">
            {monitor.intervalS < 60 ? `${monitor.intervalS}s` : `${monitor.intervalS / 60}m`}
          </p>
        </div>
      </div>

      {/* Response time chart */}
      <div className="rounded-lg border border-gray-100 bg-white p-4">
        <h2 className="mb-3 text-sm font-medium text-gray-700">Response time</h2>
        {/* uptime error — show error state instead of silently swallowing */}
        {logsError ? (
          <p className="text-sm text-red-500">{logsError}</p>
        ) : (
          <ResponseTimeChart logs={logs} />
        )}
      </div>

      {/* Uptime % with period selector */}
      <div className="rounded-lg border border-gray-100 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Uptime</h2>
          <div className="flex gap-1">
            {(['24h', '7d', '30d'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  period === p
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {/* uptime error — show error state instead of silently swallowing */}
        {uptimeError ? (
          <p className="text-sm text-red-500">{uptimeError}</p>
        ) : uptime ? (
          <div className="flex items-center gap-4">
            <UptimeBadge percent={uptime.uptimePercent} />
            <span className="text-xs text-gray-400">
              {uptime.up} up · {uptime.down} down · {uptime.total} total checks
            </span>
          </div>
        ) : (
          <div className="h-6 w-24 animate-pulse rounded bg-gray-100" />
        )}
      </div>

      {/* Incidents */}
      <div className="rounded-lg border border-gray-100 bg-white p-4">
        <h2 className="mb-3 text-sm font-medium text-gray-700">Recent incidents</h2>
        {/* uptime error — show error state instead of silently swallowing */}
        {incidentsError ? (
          <p className="text-sm text-red-500">{incidentsError}</p>
        ) : (
          <IncidentsList incidents={incidents} />
        )}
      </div>
    </div>
  )
}