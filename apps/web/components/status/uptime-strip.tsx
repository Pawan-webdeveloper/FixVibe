/*
 * 90-day uptime strip — one bar per day, green = all ok, red = any failure,
 * gray = no data. Oldest on the left, today on the right.
 *
 * Pure server component — no client JS needed.
 */

interface DayBucket {
  date: string  // "2025-10-15"
  ok: boolean
  total: number
}

interface UptimeStripProps {
  buckets: DayBucket[]
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Fills in missing days between the first bucket and today with
 * { total: 0 } so the strip always shows 90 columns.
 */
function fill90Days(buckets: DayBucket[]): Array<DayBucket | null> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const byDate = new Map(buckets.map((b) => [b.date, b]))
  const result: Array<DayBucket | null> = []

  for (let i = 89; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const key = d.toISOString().slice(0, 10)
    result.push(byDate.get(key) ?? null)
  }

  return result
}

export function UptimeStrip({ buckets }: UptimeStripProps) {
  const days = fill90Days(buckets)

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-gray-400">90 days ago</span>
        <span className="text-xs text-gray-400">Today</span>
      </div>

      {/* Bar strip */}
      <div className="flex gap-px">
        {days.map((day, i) => {
          const color =
            day === null
              ? 'bg-gray-100'           // no data
              : day.ok
                ? 'bg-emerald-400'      // all checks passed
                : 'bg-red-400'          // at least one failure

          const tooltip =
            day === null
              ? 'No data'
              : `${formatDate(day.date)} — ${day.ok ? 'Operational' : 'Incident'}`

          return (
            <div
              key={i}
              title={tooltip}
              className={`h-8 flex-1 rounded-sm ${color} transition-opacity hover:opacity-70`}
            />
          )
        })}
      </div>

      {/* Legend */}
      <div className="mt-2 flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="h-2 w-2 rounded-sm bg-emerald-400" />
          Operational
        </span>
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="h-2 w-2 rounded-sm bg-red-400" />
          Incident
        </span>
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="h-2 w-2 rounded-sm bg-gray-100" />
          No data
        </span>
      </div>
    </div>
  )
}