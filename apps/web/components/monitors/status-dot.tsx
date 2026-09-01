'use client'

interface StatusDotProps {
  status: 'up' | 'down' | null /* uptime error — use 'up'/'down' to match DB status values */
  size?: 'sm' | 'md'
}

export function StatusDot({ status, size = 'md' }: StatusDotProps) {
  const sz = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5'

  if (status === 'up') {
    return (
      <span className="relative flex shrink-0">
        <span className={`${sz} rounded-full bg-emerald-500`} />
      </span>
    )
  }

  if (status === 'down') {
    return (
      <span className="relative flex shrink-0">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75`} />
        <span className={`${sz} rounded-full bg-red-500`} />
      </span>
    )
  }

  // null = never run yet
  return (
    <span className="relative flex shrink-0">
      <span className={`${sz} rounded-full bg-gray-300`} />
    </span>
  )
}