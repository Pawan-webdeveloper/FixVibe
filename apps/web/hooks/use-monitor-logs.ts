/**
 * useMonitorLogs
 *
 * WHY custom hook: fetch logic, loading state, error handling
 * component se bahar nikalo — component sirf render kare.
 * Direct fetch in useEffect but clean aur type-safe.
 */

import { useState, useEffect, useCallback } from 'react'
import { MonitorLogsResponseSchema } from '@scanlyfix/db/types/monitor-diff.ts'
import type { MonitorLogEntry } from '@scanlyfix/db/types/monitor-diff.ts'

interface UseMonitorLogsState {
  logs: MonitorLogEntry[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useMonitorLogs(
  monitorId: string,
  limit = 50,
): UseMonitorLogsState {
  const [logs, setLogs] = useState<MonitorLogEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLogs = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(
        `/api/monitors/${monitorId}/logs?limit=${limit}`,
        {
          // WHY credentials include: session cookie bhejni hai
          credentials: 'include',
        },
      )

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }

      const json = await res.json()

      // WHY runtime validate: API response assume mat karo — Zod se validate
      const parsed = MonitorLogsResponseSchema.safeParse(json)
      if (!parsed.success) {
        throw new Error('Invalid response shape from API')
      }

      setLogs(parsed.data.logs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs')
    } finally {
      setIsLoading(false)
    }
  }, [monitorId, limit])

  useEffect(() => {
    if (!monitorId) return
    fetchLogs()
  }, [fetchLogs])

  return { logs, isLoading, error, refetch: fetchLogs }
}