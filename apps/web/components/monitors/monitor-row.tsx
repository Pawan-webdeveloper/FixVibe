'use client'

import { useState, useTransition } from 'react'
import type { MonitorType } from '@darvin/db'

/**
 * One monitor, with its switch.
 *
 * The interval is shown but not editable here. Every plausible value is a
 * trade-off between cost and resolution that a free-text field invites people
 * to get wrong — a minute-by-minute full re-scan is somebody else's bandwidth,
 * and this product has an opinion about that.
 */
export function MonitorRow({
  type,
  title,
  description,
  enabled,
  intervalLabel,
  lastStatus,
  onToggle,
}: {
  type: MonitorType
  title: string
  description: string
  enabled: boolean
  intervalLabel: string
  lastStatus: string | null
  onToggle: (type: MonitorType, enabled: boolean) => Promise<void>
}) {
  const [on, setOn] = useState(enabled)
  const [pending, startTransition] = useTransition()

  function toggle() {
    const next = !on
    // Optimistic, then reconciled by the revalidate the action triggers. A
    // switch that waits for a round trip feels broken even when it is not.
    setOn(next)
    startTransition(async () => {
      await onToggle(type, next)
    })
  }

  return (
    <li className="flex items-center gap-4 border border-line px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {title}
          {on && lastStatus && (
            <span className={`ml-2 text-xs ${lastStatus === 'ok' ? 'text-good' : 'text-critical'}`}>
              {lastStatus === 'ok' ? 'passing' : 'failing'}
            </span>
          )}
        </p>
        <p className="mt-0.5 text-sm text-muted text-pretty">{description}</p>
        <p className="mt-1 font-mono text-xs text-muted">{intervalLabel}</p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${title}: ${on ? 'on' : 'off'}`}
        onClick={toggle}
        disabled={pending}
        className={`h-6 w-11 shrink-0 transition-colors disabled:opacity-60 ${
 on ? 'bg-accent' : 'bg-line'
        }`}
      >
        <span
          className={`block h-5 w-5 bg-canvas transition-transform ${
 on ? 'translate-x-[22px]' : 'translate-x-[2px]'
          }`}
        />
      </button>
    </li>
  )
}
