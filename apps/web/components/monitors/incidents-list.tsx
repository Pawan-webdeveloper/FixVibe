'use client'

interface Incident {
  id: string
  startedAt: string
  resolvedAt: string | null
  durationMs: number | null
  statusCode: number | null
  detail: string | null
}

interface IncidentsListProps {
  incidents: Incident[]
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

function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function IncidentsList({ incidents }: IncidentsListProps) {
  if (incidents.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-400">
        No incidents recorded — all good.
      </p>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {incidents.map((incident) => {
        const isOpen = incident.resolvedAt === null

        return (
          <div key={incident.id} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                    isOpen
                      ? 'bg-red-50 text-red-600'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {isOpen && (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                  )}
                  {isOpen ? 'Ongoing' : 'Resolved'}
                </span>
                {incident.statusCode && (
                  <span className="text-xs text-gray-400">
                    HTTP {incident.statusCode}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-gray-600">
                {formatDate(incident.startedAt)}
                {incident.resolvedAt && ` — ${formatDate(incident.resolvedAt)}`}
              </p>
              {incident.detail && (
                <p className="mt-0.5 truncate text-xs text-gray-400">{incident.detail}</p>
              )}
            </div>
            <div className="shrink-0 text-right text-sm">
              {isOpen ? (
                <span className="font-medium text-red-500">ongoing</span>
              ) : incident.durationMs != null ? (
                <span className="text-gray-500">{formatDuration(incident.durationMs)}</span>
              ) : null}
            </div>
          </div>
        ) 
      })}
    </div>
  )
}