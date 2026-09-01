/*
 * Shows SSL certificate + domain expiry status for a project.
 * Used on the /monitors/[id] page when the monitor type is 'domain'.
 */


'use client'
 
import { useEffect, useState } from 'react'
 
/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */
 

 
interface SslData {
  ok: boolean
  daysUntilExpiry: number | null
  expiresAt: string | null
  subject: string | null
  detail: string | null
}
 
interface DomainData {
  ok: boolean
  daysUntilExpiry: number | null
  expiresAt: string | null
  registrar: string | null
  detail: string | null
}
 
interface MonitoringData {
  hostname: string
  ssl: SslData
  domain: DomainData
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */
 
 
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}
 
function urgencyColor(days: number | null): string {
  if (days === null) return 'text-c-muted'
  if (days <= 7) return 'text-red-500 dark:text-red-400'
  if (days <= 14) return 'text-orange-500 dark:text-orange-400'
  if (days <= 30) return 'text-amber-500 dark:text-amber-400'
  return 'text-emerald-500 dark:text-emerald-400'
}

function urgencyBg(days: number | null): string {
  if (days === null) return 'bg-c-soft/50 border-c-line'
  if (days <= 7) return 'bg-red-500/10 border-red-500/30 text-red-500'
  if (days <= 14) return 'bg-orange-500/10 border-orange-500/30 text-orange-500'
  if (days <= 30) return 'bg-amber-500/10 border-amber-500/30 text-amber-500'
  return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                       */
/* ------------------------------------------------------------------ */

interface ExpiryCardProps {
  title: string
  days: number | null
  expiresAt: string | null
  subtitle?: string | null
  detail?: string | null
}

function ExpiryCard({ title, days, expiresAt, subtitle, detail }: ExpiryCardProps) {
  return (
    <div className={`rounded-xl border p-5 ${urgencyBg(days)}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-c-muted">{title}</p>
          {subtitle && <p className="mt-1 font-mono text-xs text-c-muted">{subtitle}</p>}
        </div>
        {days !== null && (
          <span className={`text-base font-bold tabular-nums ${urgencyColor(days)}`}>
            {days <= 0 ? 'Expired' : `${days}d left`}
          </span>
        )}
      </div>

      {expiresAt && (
        <p className="mt-3 text-sm text-c-ink">
          {days !== null && days <= 0 ? 'Expired' : 'Expires'}{' '}
          <span className="font-semibold">{formatDate(expiresAt)}</span>
        </p>
      )}

      {detail && <p className="mt-1.5 text-xs text-c-muted">{detail}</p>}

      {days === null && <p className="mt-2 text-sm text-c-muted">Could not retrieve expiry data.</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main export                                                          */
/* ------------------------------------------------------------------ */

interface MonitoringDetailProps {
  monitorId: string
}

export function MonitoringDetail({ monitorId }: MonitoringDetailProps) {
  const [data, setData] = useState<MonitoringData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/monitors/${monitorId}/monitoring`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load monitoring data')
        return r.json() as Promise<MonitoringData>
      })
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Unknown error'))
      .finally(() => setLoading(false))
  }, [monitorId])

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-28 animate-pulse rounded-xl bg-c-soft" />
        <div className="h-28 animate-pulse rounded-xl bg-c-soft" />
      </div>
    )
  }

  if (error || !data) {
    return <p className="text-sm text-red-500">{error ?? 'Could not load monitoring data.'}</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-c-ink">Live Health Probe</h2>
        <span className="font-mono text-xs text-c-muted">{data.hostname}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ExpiryCard
          title="SSL Certificate"
          days={data.ssl.daysUntilExpiry}
          expiresAt={data.ssl.expiresAt}
          subtitle={data.ssl.subject ?? undefined}
          detail={data.ssl.detail ?? undefined}
        />
        <ExpiryCard
          title="Domain Registration"
          days={data.domain.daysUntilExpiry}
          expiresAt={data.domain.expiresAt}
          subtitle={data.domain.registrar ?? undefined}
          detail={data.domain.detail ?? undefined}
        />
      </div>

      <p className="text-xs text-c-muted">
        Thresholds: Alert at 14d (SSL) / 30d (Domain) · Urgent priority at 7 days.
      </p>
    </div>
  )
}
