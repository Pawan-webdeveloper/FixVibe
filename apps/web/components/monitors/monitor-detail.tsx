'use client'

import { useEffect, useState, useCallback } from 'react'
import { StatusDot } from './status-dot'
import { UptimeBadge } from './uptime-badge'
import { ResponseTimeChart } from './response-time-chart'
import { IncidentsList } from './incidents-list'
import { DiffBadge } from '@/components/monitors/diff-badge'
import { MonitorSettings } from '@/components/monitors/monitor-settings.tsx'
import { SnoozeButton } from './snooze-button'
import { RunCheckButton } from './run-check-button'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: string
  ok: boolean
  statusCode: number | null
  latencyMs: number | null
  ts: string
  diff: {
    statusCode?: { from: number | null; to: number | null }
    latencyMs?: { from: number | null; to: number | null }
    detail?: { from: string | null; to: string | null }
  } | null
}

interface Incident {
  id: string
  startedAt: string
  resolvedAt: string | null
  durationMs: number | null
  statusCode: number | null
  detail: string | null
  acknowledgedAt: string | null
  acknowledgedBy: string | null
  acknowledgerEmail: string | null
  notes: string | null
}

interface UptimeData {
  uptimePercent: number | null
  total: number
  up: number
  down: number
  avgLatencyMs: number | null
  p95LatencyMs: number | null
}

interface MonitorData {
  id: string
  type: 'uptime' | 'rescan' | 'domain' | 'web_vitals'
  projectName: string
  projectUrl: string
  lastStatus: 'up' | 'down' | null
  lastRunAt: string | null
  intervalS: number
  enabled: boolean
}

interface ResponseTimeDataPoint {
  timestamp: string
  avgLatencyMs: number | null
  p95LatencyMs: number | null
  maxLatencyMs: number | null
  totalChecks: number
}

interface MonitorDetailProps {
  monitor: MonitorData
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function MonitorDetail({ monitor }: MonitorDetailProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [uptime, setUptime] = useState<UptimeData | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [period, setPeriod] = useState<'24h' | '7d' | '30d'>('7d')
  const [responseTimeRange, setResponseTimeRange] = useState<'1h' | '24h' | '7d'>('24h')
  const [responseTimeData, setResponseTimeData] = useState<ResponseTimeDataPoint[]>([])
  const [logsError, setLogsError] = useState<string | null>(null)
  const [uptimeError, setUptimeError] = useState<string | null>(null)
  const [incidentsError, setIncidentsError] = useState<string | null>(null)
  const [responseTimeError, setResponseTimeError] = useState<string | null>(null)

  // ── Fetch: Logs ──────────────────────────────────────────────────────────────
  const loadLogs = useCallback(() => {
    fetch(`/api/monitors/${monitor.id}/logs`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load logs')
        return r.json()
      })
      .then((d) => {
        setLogs(d.logs ?? [])
        setLogsError(null)
      })
      .catch((e: unknown) =>
        setLogsError(e instanceof Error ? e.message : 'Failed to load logs'),
      )
  }, [monitor.id])

  // ── Fetch: Uptime ────────────────────────────────────────────────────────────
  const loadUptime = useCallback(() => {
    fetch(`/api/monitors/${monitor.id}/uptime?period=${period}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load uptime')
        return r.json()
      })
      .then((d) => {
        setUptime(d)
        setUptimeError(null)
      })
      .catch((e: unknown) =>
        setUptimeError(e instanceof Error ? e.message : 'Failed to load uptime'),
      )
  }, [monitor.id, period])

  // ── Fetch: Response Times ────────────────────────────────────────────────────
  const loadResponseTimes = useCallback(() => {
    fetch(`/api/monitors/${monitor.id}/response-times?range=${responseTimeRange}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load response times')
        return r.json()
      })
      .then((d) => {
        setResponseTimeData(d.data ?? [])
        setResponseTimeError(null)
      })
      .catch((e: unknown) =>
        setResponseTimeError(e instanceof Error ? e.message : 'Failed to load response times'),
      )
  }, [monitor.id, responseTimeRange])

  // ── Fetch: Incidents ─────────────────────────────────────────────────────────
  const loadIncidents = useCallback(() => {
    fetch(`/api/monitors/${monitor.id}/incidents`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load incidents')
        return r.json()
      })
      .then((d) => {
        setIncidents(d.incidents ?? [])
        setIncidentsError(null)
      })
      .catch((e: unknown) =>
        setIncidentsError(
          e instanceof Error ? e.message : 'Failed to load incidents',
        ),
      )
  }, [monitor.id])

  // ── Effects ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadLogs()
    const id = setInterval(loadLogs, 30_000)
    return () => clearInterval(id)
  }, [loadLogs])

  useEffect(() => {
    loadUptime()
  }, [loadUptime])

  useEffect(() => {
    loadResponseTimes()
  }, [loadResponseTimes])

  useEffect(() => {
    loadIncidents()
  }, [loadIncidents])

  // ── Derived ──────────────────────────────────────────────────────────────────
  const avgLatency =
    logs.length > 0
      ? Math.round(
          logs.reduce((s, l) => s + (l.latencyMs ?? 0), 0) / logs.length,
        )
      : null

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <StatusDot status={monitor.lastStatus} size="md" />
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              {monitor.projectName}
            </h1>
            <p className="text-sm text-gray-400">{monitor.projectUrl}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Run-check (Phase 7.3). We hand it the newest log's id/ts
              as a baseline so the polling inside the button knows
              what counts as "a new row" without re-deriving it. */}
          <RunCheckButton
            monitorId={monitor.id}
            baseline={
              logs[0] !== undefined
                ? { firstId: logs[0].id, firstTs: logs[0].ts }
                : null
            }
            onChecked={() => {
              loadLogs()
              loadUptime()
            }}
          />
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              monitor.lastStatus === 'up'
                ? 'bg-emerald-50 text-emerald-700'
                : monitor.lastStatus === 'down'
                  ? 'bg-red-50 text-red-700'
                  : 'bg-gray-100 text-gray-500'
            }`}
          >
            {monitor.lastStatus === 'up'
              ? 'UP'
              : monitor.lastStatus === 'down'
                ? 'DOWN'
                : 'PENDING'}
          </span>
        </div>
      </div>

      {/* ── Snooze — sirf uptime monitors pe ───────────────────────────────── */}
      {monitor.type === 'uptime' && (
        <SnoozeButton monitorId={monitor.id} onChanged={loadLogs} />
      )}

      {/* ── Stats row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-100 bg-white px-4 py-3">
          <p className="text-xs text-gray-400">Uptime (7d)</p>
          <div className="mt-1">
            {uptime ? (
              <UptimeBadge percent={uptime.uptimePercent} />
            ) : (
              <span className="text-sm text-gray-300">—</span>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white px-4 py-3">
          <p className="text-xs text-gray-400">Response time</p>
          <p className="mt-1 text-sm font-medium text-gray-700">
            {uptime?.avgLatencyMs != null && uptime?.p95LatencyMs != null ? (
              <>Avg {uptime.avgLatencyMs}ms · p95 {uptime.p95LatencyMs}ms</>
            ) : avgLatency !== null ? (
              `${avgLatency}ms`
            ) : (
              '—'
            )}
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
            {monitor.intervalS < 60
              ? `${monitor.intervalS}s`
              : `${monitor.intervalS / 60}m`}
          </p>
        </div>
      </div>

      {/* ── Response time chart ─────────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-100 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Response time</h2>
          <div className="flex gap-1">
            {(['1h', '24h', '7d'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setResponseTimeRange(r)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  responseTimeRange === r
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        {responseTimeError ? (
          <p className="text-sm text-red-500">{responseTimeError}</p>
        ) : (
          <ResponseTimeChart
            data={responseTimeData}
            range={responseTimeRange}
            p95LatencyMs={uptime?.p95LatencyMs}
          />
        )}
      </div>

      {/* ── Uptime % with period selector ───────────────────────────────────── */}
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

      {/* ── Incidents ───────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-100 bg-white p-4">
        <h2 className="mb-3 text-sm font-medium text-gray-700">
          Recent incidents
        </h2>
        {incidentsError ? (
          <p className="text-sm text-red-500">{incidentsError}</p>
        ) : (
          <IncidentsList incidents={incidents} />
        )}
      </div>

      {/* ── Alert settings ──────────────────────────────────────────────────── */}
      {monitor.type === 'uptime' && (
        <div className="rounded-lg border border-gray-100 bg-white p-4">
          <h2 className="mb-3 text-sm font-medium text-gray-700">Alert settings</h2>
          <MonitorSettings monitorId={monitor.id} />
        </div>
      )}

      {/* ── Recent Checks (with diff) ────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-100 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-700">Recent checks</h2>
          {logsError && (
            <button
              onClick={loadLogs}
              className="text-xs text-red-500 underline"
            >
              Retry
            </button>
          )}
        </div>

        {logsError ? (
          <p className="text-sm text-red-500">{logsError}</p>
        ) : logs.length === 0 ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="h-6 w-full animate-pulse rounded bg-gray-100"
              />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="flex items-center gap-3">
                  <StatusDot status={log.ok ? 'up' : 'down'} size="sm" />
                  <span className="font-mono text-sm text-gray-700">
                    {log.statusCode ?? '—'}
                  </span>
                  <span className="text-sm text-gray-400">
                    {log.latencyMs !== null ? `${log.latencyMs}ms` : '—'}
                  </span>
                  <span className="ml-auto text-xs text-gray-300">
                    {timeAgo(log.ts)}
                  </span>
                </div>
                {log.diff !== null && <DiffBadge diff={log.diff} />}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}