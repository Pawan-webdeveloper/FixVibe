'use client'

interface StatusDotProps {
  status: 'up' | 'down' | 'stale' | null
  size?: 'sm' | 'md'
  tooltip?: string
}

export function StatusDot({ status, size = 'md', tooltip }: StatusDotProps) {
  const sz = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5'

  if (status === 'up') {
    return (
      <span className="relative flex shrink-0" title={tooltip}>
        <span className={`${sz} rounded-full bg-emerald-500`} />
      </span>
    )
  }

  if (status === 'down') {
    return (
      <span className="relative flex shrink-0" title={tooltip}>
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75`} />
        <span className={`${sz} rounded-full bg-red-500`} />
      </span>
    )
  }

  if (status === 'stale') {
    return (
      <span className="relative flex shrink-0" title={tooltip}>
        <span className={`${sz} rounded-full bg-gray-400 ring-2 ring-amber-400/50`} />
      </span>
    )
  }

  // null = never run yet
  return (
    <span className="relative flex shrink-0" title={tooltip}>
      <span className={`${sz} rounded-full bg-gray-300`} />
    </span>
  )
}