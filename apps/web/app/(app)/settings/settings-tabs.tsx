'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * A client component for one reason: a layout is not told the pathname, and
 * marking the current tab is the whole job. `aria-current` is not decoration —
 * without it a screen reader hears two links and no indication of where it is.
 */

const TABS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/settings/billing', label: 'Billing' },
  { href: '/settings/api-keys', label: 'API keys' },
]

export function SettingsTabs() {
  const pathname = usePathname()

  return (
    <nav aria-label="Settings" className="mt-6 flex gap-6 border-b border-line">
      {TABS.map((tab) => {
        const current = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            {...(current ? { 'aria-current': 'page' as const } : {})}
            className={`label -mb-px border-b-2 pb-3 transition-colors ${
              current ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
