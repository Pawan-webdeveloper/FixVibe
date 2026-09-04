'use client'

interface UptimeBadgeProps {
  percent: number | null
}

export function UptimeBadge({ percent }: UptimeBadgeProps) {
  if (percent === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
        No data
      </span>
    )
  }

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