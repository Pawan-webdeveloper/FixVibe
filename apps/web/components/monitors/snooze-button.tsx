'use client'

/**
 * FILE: apps/web/components/monitors/snooze-button.tsx
 *
 * Snooze/unsnooze control for a monitor.
 * Matches your existing dark-theme styling (bg-c-soft, text-c-muted, etc.)
 *
 * Props:
 *   monitorId — the monitor to snooze/unsnooze
 *   onChanged  — called after snooze state changes (parent reloads data)
 */

import { useEffect, useState } from 'react'

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

interface SnoozeRow {
  id: string
  expiresAt: string | null
  reason: string | null
  createdAt: string
}

interface SnoozeOption {
  label: string
  /** Duration in ms. null = indefinite. */
  durationMs: number | null
}

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

const SNOOZE_OPTIONS: SnoozeOption[] = [
  { label: '1 hour', durationMs: 60 * 60 * 1000 },
  { label: '4 hours', durationMs: 4 * 60 * 60 * 1000 },
  { label: '24 hours', durationMs: 24 * 60 * 60 * 1000 },
  { label: 'Until I resume', durationMs: null },
]

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function timeRemaining(expiresAt: string | null): string {
  if (!expiresAt) return 'indefinitely'
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return 'expiring soon'
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m remaining`
  return `${m}m remaining`
}

/* ------------------------------------------------------------------ */
/* Modal                                                                */
/* ------------------------------------------------------------------ */

interface SnoozeModalProps {
  monitorId: string
  onClose: () => void
  onSnoozed: () => void
}

function SnoozeModal({ monitorId, onClose, onSnoozed }: SnoozeModalProps) {
  const [selected, setSelected] = useState<SnoozeOption>(SNOOZE_OPTIONS[0]!)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setSaving(true)
    setError(null)

    const expiresAt = selected.durationMs
      ? new Date(Date.now() + selected.durationMs).toISOString()
      : null

    try {
      const res = await fetch(`/api/monitors/${monitorId}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiresAt,
          reason: reason.trim() || null,
        }),
      })

      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Failed to snooze')
        return
      }

      onSnoozed()
      onClose()
    } catch {
      setError('Network error — try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-2xl border border-c-line bg-c-base p-6 shadow-xl">
        <h2 className="mb-1 text-base font-semibold text-c-ink">Snooze alerts</h2>
        <p className="mb-5 text-sm text-c-muted">
          No alerts will be sent while snoozed. Checks still run.
        </p>

        {/* Duration options */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          {SNOOZE_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => setSelected(opt)}
              className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                selected.label === opt.label
                  ? 'border-c-accent bg-c-accent/10 text-c-accent'
                  : 'border-c-line bg-c-soft text-c-ink hover:border-c-accent/50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Reason */}
        <div className="mb-5">
          <label className="mb-1.5 block text-xs font-medium text-c-muted">
            Reason (optional)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Deploying v2.0"
            maxLength={200}
            className="w-full rounded-lg border border-c-line bg-c-soft px-3 py-2 text-sm text-c-ink placeholder-c-muted focus:border-c-accent focus:outline-none"
          />
        </div>

        {error && <p className="mb-3 text-xs text-red-500">{error}</p>}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-amber-400"
          >
            {saving ? 'Snoozing…' : `Snooze for ${selected.label}`}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-c-line px-4 py-2 text-sm text-c-muted hover:text-c-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main export                                                          */
/* ------------------------------------------------------------------ */

interface SnoozeButtonProps {
  monitorId: string
  onChanged?: () => void
}

export function SnoozeButton({ monitorId, onChanged }: SnoozeButtonProps) {
  const [snooze, setSnooze] = useState<SnoozeRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [unsnoozing, setUnsnoozing] = useState(false)

  async function load() {
    try {
      const res = await fetch(`/api/monitors/${monitorId}/snooze`)
      const data = (await res.json()) as { snooze: SnoozeRow | null }
      setSnooze(data.snooze)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [monitorId])

  async function unsnooze() {
    setUnsnoozing(true)
    try {
      await fetch(`/api/monitors/${monitorId}/snooze`, { method: 'DELETE' })
      setSnooze(null)
      onChanged?.()
    } finally {
      setUnsnoozing(false)
    }
  }

  if (loading) return null

  if (snooze) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
        <span className="text-sm text-amber-500">
          🔕 Snoozed {timeRemaining(snooze.expiresAt)}
          {snooze.reason && (
            <span className="ml-1 text-amber-400/70">— {snooze.reason}</span>
          )}
        </span>
        <button
          onClick={unsnooze}
          disabled={unsnoozing}
          className="ml-auto text-xs font-medium text-amber-400 hover:text-amber-300 disabled:opacity-50"
        >
          {unsnoozing ? 'Resuming…' : 'Resume alerts'}
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-1.5 rounded-lg border border-c-line bg-c-soft px-3 py-2 text-sm text-c-muted transition-colors hover:border-c-accent/50 hover:text-c-ink"
      >
        <span>🔔</span>
        <span>Snooze alerts</span>
      </button>

      {showModal && (
        <SnoozeModal
          monitorId={monitorId}
          onClose={() => setShowModal(false)}
          onSnoozed={() => {
            load()
            onChanged?.()
          }}
        />
      )}
    </>
  )
}