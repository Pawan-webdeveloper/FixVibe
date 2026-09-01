/*
 * React hooks for incident data. Uses regular fetch + React polling.
 * Auto-polls every 30 s so the dashboard stays fresh without a full reload.
 */

/* monitor error — replaced tRPC hooks with regular fetch since @/lib/trpc
 * does not exist. Uses same polling behavior via refetchInterval pattern. */

import { useEffect, useState, useCallback } from 'react'

const POLL_INTERVAL_MS = 30_000

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

interface Incident {
  id: string
  monitorId: string
  startedAt: Date
  resolvedAt: Date | null
  durationMs: number | null
  statusCode: number | null
  detail: string | null
}

interface UseQueryResult<T> {
  data: T | undefined
  isLoading: boolean
  isError: boolean
}

/* ------------------------------------------------------------------ */
/* Hooks                                                                */
/* ------------------------------------------------------------------ */

/**
 * Returns paginated incidents for a single monitor.
 *
 * Usage:
 *   const { data, isLoading } = useMonitorIncidents(monitorId)
 */
export function useMonitorIncidents(monitorId: string, limit = 50): UseQueryResult<Incident[]> {
  const [data, setData] = useState<Incident[] | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)

  const load = useCallback(async () => {
    if (!monitorId) return
    try {
      const res = await fetch(`/api/monitors/${monitorId}/incidents?limit=${limit}`)
      if (!res.ok) throw new Error('Failed to load')
      const d = await res.json()
      setData(d.incidents ?? [])
      setIsError(false)
    } catch {
      setIsError(true)
    } finally {
      setIsLoading(false)
    }
  }, [monitorId, limit])

  useEffect(() => {
    load()
    const id = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [load])

  return { data, isLoading, isError }
}

/**
 * Returns the open (ongoing) incident for a monitor, or null.
 * Polls frequently so the "currently down" badge updates promptly.
 *
 * Usage:
 *   const { data: openIncident } = useOpenIncident(monitorId)
 */
export function useOpenIncident(monitorId: string): UseQueryResult<Incident | null> {
  const [data, setData] = useState<Incident | null | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)

  const load = useCallback(async () => {
    if (!monitorId) return
    try {
      const res = await fetch(`/api/monitors/${monitorId}/incidents/open`)
      if (!res.ok) throw new Error('Failed to load')
      const d = await res.json()
      setData(d.incident ?? null)
      setIsError(false)
    } catch {
      setIsError(true)
    } finally {
      setIsLoading(false)
    }
  }, [monitorId])

  useEffect(() => {
    load()
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [load])

  return { data, isLoading, isError }
}

/**
 * Returns all open incidents across every monitor.
 * Use on a global status page or alert banner.
 *
 * Usage:
 *   const { data: openIncidents } = useAllOpenIncidents()
 */
export function useAllOpenIncidents(): UseQueryResult<Incident[]> {
  const [data, setData] = useState<Incident[] | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/incidents/open')
      if (!res.ok) throw new Error('Failed to load')
      const d = await res.json()
      setData(d.incidents ?? [])
      setIsError(false)
    } catch {
      setIsError(true)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [load])

  return { data, isLoading, isError }
}
