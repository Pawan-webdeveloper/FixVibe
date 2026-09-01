'use client'

interface LogEntry {
  latencyMs: number | null
  ok: boolean
  ts: string
}

interface ResponseTimeChartProps {
  logs: LogEntry[]
}

function barColor(latencyMs: number, ok: boolean): string {
  if (!ok) return 'bg-red-400'
  if (latencyMs < 200) return 'bg-emerald-400'
  if (latencyMs < 500) return 'bg-yellow-400'
  return 'bg-orange-400'
}

export function ResponseTimeChart({ logs }: ResponseTimeChartProps) {
  if (logs.length === 0) {
    return (
      <div className="flex h-16 items-center justify-center rounded-lg bg-gray-50 text-xs text-gray-400">
        No data yet
      </div>
    )
  }

  // Take last 48 entries, oldest → newest (left → right)
  const visible = [...logs].reverse().slice(-48)
  const maxLatency = Math.max(...visible.map((l) => l.latencyMs ?? 0), 1)

  return (
    <div className="space-y-1">
      <div className="flex h-16 items-end gap-px">
        {visible.map((log, i) => {
          const latency = log.latencyMs ?? 0
          const heightPct = Math.max((latency / maxLatency) * 100, 4)
          const color = barColor(latency, log.ok)
          const time = new Date(log.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

          return (
            <div
              key={i}
              className="group relative flex-1"
              style={{ height: '100%', display: 'flex', alignItems: 'flex-end' }}
            >
              <div
                className={`w-full rounded-sm ${color} transition-opacity group-hover:opacity-80`}
                style={{ height: `${heightPct}%` }}
              />
              {/* Tooltip */}
              <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white group-hover:block z-10">
                {log.ok ? `${latency}ms` : 'Failed'} · {time}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-400">
        <span>{maxLatency}ms max</span>
        <span>last {visible.length} checks</span>
      </div>
    </div>
  )
}