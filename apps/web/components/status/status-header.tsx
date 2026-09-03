/*
 * Top section of the public status page.
 * Shows current UP/DOWN state, last checked time, and uptime %.
 * No client JS needed — pure server component.
 */

interface StatusHeaderProps {
  projectName: string
  projectUrl: string
  currentStatus: 'ok' | 'failed' | 'unknown'
  lastCheckedAt: Date | null
  uptimePercent: number
}

function timeAgo(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export function StatusHeader({
  projectName,
  projectUrl,
  currentStatus,
  lastCheckedAt,
  uptimePercent,
}: StatusHeaderProps) {
  const isUp = currentStatus === 'ok'
  const isUnknown = currentStatus === 'unknown'

  return (
    <div className="border-b border-gray-100 pb-8">
      {/* Project name + URL */}
      <div className="mb-6 flex items-center gap-3">
        <span
          className={`h-3 w-3 rounded-full ${
            isUnknown
              ? 'bg-gray-300'
              : isUp
                ? 'bg-emerald-500'
                : 'animate-pulse bg-red-500'
          }`}
        />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{projectName}</h1>
          <p className="text-sm text-gray-400">{projectUrl}</p>
        </div>
      </div>

      {/* Status banner */}
      <div
        className={`rounded-lg px-5 py-4 ${
          isUnknown
            ? 'bg-gray-50'
            : isUp
              ? 'bg-emerald-50'
              : 'bg-red-50'
        }`}
      >
        <p
          className={`text-lg font-semibold ${
            isUnknown
              ? 'text-gray-500'
              : isUp
                ? 'text-emerald-700'
                : 'text-red-700'
          }`}
        >
          {isUnknown
            ? 'No data yet'
            : isUp
              ? 'All systems operational'
              : 'Service disruption detected'}
        </p>

        {lastCheckedAt && (
          <p className="mt-1 text-sm text-gray-400">
            Last checked {timeAgo(lastCheckedAt)}
          </p>
        )}
      </div>

      {/* Uptime stat */}
      {!isUnknown && (
        <div className="mt-4 flex items-center gap-2">
          <span className="text-sm text-gray-500">90-day uptime</span>
          <span
            className={`text-sm font-semibold tabular-nums ${
              uptimePercent >= 99.9
                ? 'text-emerald-600'
                : uptimePercent >= 99
                  ? 'text-yellow-600'
                  : 'text-red-600'
            }`}
          >
            {uptimePercent.toFixed(2)}%
          </span>
        </div>
      )}
    </div>
  )
}