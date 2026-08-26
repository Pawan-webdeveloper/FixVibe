'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Scroll-reveal wrapper: children fade/rise in once when they enter the
 * viewport. Purely presentational — content is server-rendered and only the
 * initial hidden state is applied client-side, so no-JS visitors still see
 * everything (the .reveal class hides nothing until JS mounts).
 */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    document.documentElement.classList.add('js-ready')
    const node = ref.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      data-visible={visible}
      style={delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
      className={`reveal ${className}`}
    >
      {children}
    </div>
  )
}
