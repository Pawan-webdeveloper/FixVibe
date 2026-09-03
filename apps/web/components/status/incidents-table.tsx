/*
 * Recent incidents section of the public status page.
 * Pure server component — no client JS.
 */

interface PublicIncident {
  startedAt: Date
  resolvedAt: Date | null
  durationMs: number | null
  statusCode: number | null
  detail: string | null
}

interface IncidentsTableProps {
  incidents: PublicIncident[]
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

export function IncidentsTable({ incidents }: IncidentsTableProps) {
  if (incidents.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 py-10 text-center">
        <p className="text-sm text-gray-400">No incidents in the last 90 days.</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {incidents.map((incident, i) => {
        const isOpen = incident.resolvedAt === null

        return (
          <div key={i} className="flex items-start justify-between gap-4 py-4">
            <div className="min-w-0 flex-1">
              {/* Status badge */}
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
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

              {/* Timestamps */}
              <p className="text-sm text-gray-700">
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

            {/* Duration */}
            <div className="shrink-0 text-right">
              {isOpen ? (
                <span className="text-sm font-medium text-red-500">ongoing</span>
              ) : incident.durationMs != null ? (
                <span className="text-sm text-gray-500">
                  {formatDuration(incident.durationMs)}
                </span>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}