'use client'

/*
 * Alert threshold configuration UI for uptime monitors.
 *
 * Dropdowns + latency input → PATCH /api/monitors/:id/config
 *
 * WHY no form tag: existing codebase pattern (monitor-detail.tsx same)
 * WHY local state (not React Query): simple save — no cache invalidation needed
 */

import { useState, useEffect, useCallback } from 'react'
import { ALERT_PRESETS, type AlertPresetKey, type AlertConfig } from '@/lib/alert-threshold.ts'

interface MonitorSettingsProps {
  monitorId: string
  onSaved?: () => void
}

// ─── Preset detector ──────────────────────────────────────────────────────────
// WHY: Map saved failStatusCodes back to a preset key for the dropdown
function detectPreset(alertConfig: AlertConfig | null): AlertPresetKey {
  if (!alertConfig?.failStatusCodes || alertConfig.failStatusCodes.length === 0) {
    return 'default'
  }
  const codes = new Set(alertConfig.failStatusCodes)

  if (
    codes.size === ALERT_PRESETS['5xx_only'].failStatusCodes.length &&
    ALERT_PRESETS['5xx_only'].failStatusCodes.every((c) => codes.has(c))
  ) {
    return '5xx_only'
  }
  if (codes.size >= 200 && [...codes].every((c) => c >= 400)) {
    return '4xx_and_5xx'
  }
  return 'default'
}

// ─── Component ─────────────────────────────────────────────────────────────────
export function MonitorSettings({ monitorId, onSaved }: MonitorSettingsProps) {
  const [preset, setPreset] = useState<AlertPresetKey>('default')
  const [maxLatencyMs, setMaxLatencyMs] = useState<string>('')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // ── Load current config ──────────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/monitors/${monitorId}/config`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error('Failed to load config')

      const data = await res.json() as { alertConfig: AlertConfig | null }
      const config = data.alertConfig

      setPreset(detectPreset(config))
      setMaxLatencyMs(config?.maxLatencyMs ? String(config.maxLatencyMs) : '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config')
    } finally {
      setIsLoading(false)
    }
  }, [monitorId])

  useEffect(() => { loadConfig() }, [loadConfig])

  // ── Save handler ─────────────────────────────────────────────────────────────
  async function handleSave() {
    setIsSaving(true)
    setError(null)
    setSaved(false)

    // Build alertConfig from UI state
    const presetDef = ALERT_PRESETS[preset]
    const latency = maxLatencyMs ? parseInt(maxLatencyMs, 10) : null

    const alertConfig: AlertConfig = {
      failStatusCodes:
        'failStatusCodes' in presetDef ? presetDef.failStatusCodes as number[] : undefined,
      maxLatencyMs: latency && !isNaN(latency) ? latency : null,
    }

    try {
      const res = await fetch(`/api/monitors/${monitorId}/config`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertConfig }),
      })

      const data = await res.json() as { ok?: boolean; error?: string }

      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to save config')
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="h-9 w-full animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* Status code threshold */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-gray-600">
          Alert on
        </label>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as AlertPresetKey)}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700
                     focus:border-gray-400 focus:outline-none focus:ring-0"
        >
          {(Object.keys(ALERT_PRESETS) as AlertPresetKey[]).map((key) => (
            <option key={key} value={key}>
              {ALERT_PRESETS[key].label}
            </option>
          ))}
        </select>
      </div>

      {/* Latency threshold */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-gray-600">
          Max latency (ms)
          <span className="ml-1 font-normal text-gray-400">optional</span>
        </label>
        <input
          type="number"
          min={100}
          max={60000}
          step={100}
          placeholder="e.g. 3000"
          value={maxLatencyMs}
          onChange={(e) => setMaxLatencyMs(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700
                     placeholder:text-gray-300 focus:border-gray-400 focus:outline-none focus:ring-0"
        />
        {maxLatencyMs && (
          <p className="text-xs text-gray-400">
            Alert when response takes longer than {Number(maxLatencyMs).toLocaleString()}ms
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={isSaving}
        className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm
                   font-medium text-white transition-opacity hover:opacity-80
                   disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSaving ? 'Saving…' : saved ? '✓ Saved' : 'Save settings'}
      </button>

    </div>
  )
}