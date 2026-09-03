/**
 * DiffBadge
 *
 * Ek monitor log entry ka diff display karta hai.
 * Status code change, latency change, aur detail change.
 *
 * WHY separate component: monitor-detail.tsx already complex hai —
 * diff rendering logic alag rakhna easy to test aur maintain hai.
 */

import type { MonitorEventDiff } from '@scanlyfix/db/types/monitor-diff.ts'
import { cn } from '@/lib/utils'    // tumhara existing cn utility

interface DiffBadgeProps {
  diff: MonitorEventDiff | null
  className?: string
}

// ─── Arrow component ───────────────────────────────────────────────────────────
function DiffArrow({ from, to, unit = '' }: {
  from: string | number | null
  to: string | number | null
  unit?: string
}) {
  const fromLabel = from ?? '—'
  const toLabel = to ?? '—'

  // WHY color logic: DOWN (null to ki taraf) = red, UP = green, neutral = amber
  const isDown = to === null || (typeof to === 'number' && typeof from === 'number' && to > from)
  const isUp = from === null || (typeof to === 'number' && typeof from === 'number' && to < from)

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono text-xs',
        isDown && 'text-red-600 dark:text-red-400',
        isUp && 'text-emerald-600 dark:text-emerald-400',
        !isDown && !isUp && 'text-amber-600 dark:text-amber-400',
      )}
    >
      <span className="opacity-70">{fromLabel}{unit}</span>
      <span>→</span>
      <span className="font-semibold">{toLabel}{unit}</span>
    </span>
  )
}

// ─── Main DiffBadge ────────────────────────────────────────────────────────────
export function DiffBadge({ diff, className }: DiffBadgeProps) {
  if (!diff) return null

  const changes: React.ReactNode[] = []

  if (diff.statusCode) {
    changes.push(
      <span key="status" className="flex items-center gap-1">
        <span className="text-muted-foreground">Status</span>
        <DiffArrow from={diff.statusCode.from} to={diff.statusCode.to} />
      </span>,
    )
  }

  if (diff.latencyMs) {
    changes.push(
      <span key="latency" className="flex items-center gap-1">
        <span className="text-muted-foreground">Latency</span>
        <DiffArrow
          from={diff.latencyMs.from}
          to={diff.latencyMs.to}
          unit="ms"
        />
      </span>,
    )
  }

  if (diff.detail) {
    changes.push(
      <span key="detail" className="flex items-center gap-1">
        <span className="text-muted-foreground">Reason</span>
        <span className="text-xs text-amber-600 dark:text-amber-400 max-w-[200px] truncate">
          {diff.detail.to ?? '—'}
        </span>
      </span>,
    )
  }

  // Kuch nahi change hua (edge case — diff = {} prevent kiya hai query mein)
  if (changes.length === 0) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md',
        'bg-amber-50 dark:bg-amber-950/30',
        'border border-amber-200 dark:border-amber-800',
        'px-2 py-1',
        className,
      )}
    >
      <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
        Changed
      </span>
      {changes}
    </div>
  )
}