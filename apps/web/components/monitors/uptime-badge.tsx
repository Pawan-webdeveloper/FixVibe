'use client'

interface UptimeBadgeProps {
  percent: number
}

export function UptimeBadge({ percent }: UptimeBadgeProps) {
  const formatted = percent.toFixed(2) + '%'

  const color =
    percent >= 99.9
      ? 'text-emerald-600 bg-emerald-50'
      : percent >= 99
        ? 'text-yellow-600 bg-yellow-50'
        : 'text-red-600 bg-red-50'

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${color}`}>
      {formatted}
    </span>
  )
}