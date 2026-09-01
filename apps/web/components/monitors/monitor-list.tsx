'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { StatusDot } from './status-dot'
import { UptimeBadge } from './uptime-badge'

interface MonitorItem {
  id: string
  type: string
  enabled: boolean
  lastStatus: 'up' | 'down' | null /* uptime error — use 'up'/'down' to match DB status values */
  lastRunAt: string | null
  intervalS: number
  projectUrl: string
  projectName: string
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function MonitorRow({ monitor }: { monitor: MonitorItem }) {
  const [uptime, setUptime] = useState<number | null>(null)

  useEffect(() => {
    if (monitor.type === 'uptime') {
      fetch(`/api/monitors/${monitor.id}/uptime?period=7d`)
        .then((r) => r.json())
        .then((d) => setUptime(d.uptimePercent))
        .catch(() => null)
    }
  }, [monitor.id, monitor.type])

  const typeBadge = () => {
    if (monitor.type === 'uptime') {
      return uptime !== null ? <UptimeBadge percent={uptime} /> : null
    }
    if (monitor.type === 'domain') {
      return (
        <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
          SSL &amp; Domain
        </span>
      )
    }
    if (monitor.type === 'rescan') {
      return (
        <span className="rounded-md bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
          Daily Re-scan
        </span>
      )
    }
    return null
  }

  const intervalText = () => {
    if (monitor.intervalS >= 86400) return 'daily'
    if (monitor.intervalS < 60) return `every ${monitor.intervalS}s`
    return `every ${Math.round(monitor.intervalS / 60)}m`
  }

  return (
    <Link
      href={`/monitors/${monitor.id}`}
      className="flex items-center gap-4 rounded-lg border border-c-line bg-c-card px-4 py-3 transition-colors hover:border-c-line/80 hover:bg-c-soft"
    >
      <StatusDot status={monitor.lastStatus} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-c-ink">{monitor.projectName}</p>
        <p className="font-mono text-xs text-c-muted">{monitor.projectUrl}</p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {typeBadge()}
        <span className="text-xs text-c-muted">
          {monitor.lastRunAt ? timeAgo(monitor.lastRunAt) : 'never'}
        </span>
        <span className="text-xs text-c-muted/70">{intervalText()}</span>
      </div>
    </Link>
  )
}

export function MonitorList() {
  const [monitors, setMonitors] = useState<MonitorItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = () =>
      fetch('/api/monitors')
        .then((r) => r.json())
        .then((d) => setMonitors(d.monitors ?? []))
        .finally(() => setLoading(false))

    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-c-soft" />
        ))}
      </div>
    )
  }

  if (monitors.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-c-line bg-c-card py-16 text-center">
        <p className="text-sm text-c-muted">No monitors yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {monitors.map((m) => (
        <MonitorRow key={m.id} monitor={m} />
      ))}
    </div>
  )
}