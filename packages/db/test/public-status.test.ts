/**
 * Tests for getPublicStatus (multi-component) and its pure helpers.
 *
 * The orchestrator is tested with a fully-mocked db — we exercise the
 * shape of the queries it builds and the data flow from each monitor
 * to the response, not SQL itself. The pure helpers (aggregateOverallStatus,
 * aggregateUptimePercent, mostRecentCheck, componentLabel, sortComponents)
 * are tested without any DB.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aggregateOverallStatus,
  aggregateUptimePercent,
  componentLabel,
  getPublicStatus,
  mostRecentCheck,
  sortComponents,
} from '../src/queries/monitors.ts'

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

describe('aggregateOverallStatus', () => {
  it('returns "ok" when every component is ok', () => {
    expect(aggregateOverallStatus(['ok', 'ok', 'ok'])).toBe('ok')
  })

  it('returns "failed" if ANY component is failed', () => {
    expect(aggregateOverallStatus(['ok', 'failed', 'ok'])).toBe('failed')
  })

  it('returns "unknown" when nothing failed but at least one is unknown', () => {
    expect(aggregateOverallStatus(['ok', 'unknown'])).toBe('unknown')
  })

  it('failed beats unknown', () => {
    expect(aggregateOverallStatus(['unknown', 'failed', 'ok'])).toBe('failed')
  })

  it('returns "unknown" for empty list (no components = no verdict)', () => {
    expect(aggregateOverallStatus([])).toBe('unknown')
  })

  it('does not mutate the input array', () => {
    const input = ['ok', 'failed']
    aggregateOverallStatus(input)
    expect(input).toEqual(['ok', 'failed'])
  })
})

describe('aggregateUptimePercent', () => {
  it('averages uptime % across uptime components', () => {
    const result = aggregateUptimePercent([
      { type: 'uptime', uptimePercent: 100 },
      { type: 'uptime', uptimePercent: 98.5 },
    ])
    expect(result).toBeCloseTo(99.25, 2)
  })

  it('ignores non-uptime components (domain/web_vitals/rescan)', () => {
    const result = aggregateUptimePercent([
      { type: 'uptime', uptimePercent: 99.9 },
      { type: 'domain', uptimePercent: 100 },
      { type: 'web_vitals', uptimePercent: 100 },
      { type: 'rescan', uptimePercent: 100 },
    ])
    expect(result).toBe(99.9)
  })

  it('ignores uptime components with null uptimePercent (no data yet)', () => {
    const result = aggregateUptimePercent([
      { type: 'uptime', uptimePercent: null },
      { type: 'uptime', uptimePercent: 99 },
    ])
    expect(result).toBe(99)
  })

  it('returns null when no uptime component has data', () => {
    expect(
      aggregateUptimePercent([
        { type: 'uptime', uptimePercent: null },
        { type: 'domain', uptimePercent: 100 },
      ]),
    ).toBeNull()
  })

  it('returns null for empty list', () => {
    expect(aggregateUptimePercent([])).toBeNull()
  })
})

describe('mostRecentCheck', () => {
  it('returns the latest timestamp', () => {
    const a = new Date('2025-01-01T00:00:00Z')
    const b = new Date('2025-01-02T00:00:00Z')
    const c = new Date('2025-01-01T12:00:00Z')
    expect(mostRecentCheck([{ lastCheckedAt: a }, { lastCheckedAt: b }, { lastCheckedAt: c }])).toEqual(b)
  })

  it('skips null values', () => {
    const a = new Date('2025-01-01T00:00:00Z')
    expect(mostRecentCheck([{ lastCheckedAt: null }, { lastCheckedAt: a }])).toEqual(a)
  })

  it('returns null when nothing has been checked', () => {
    expect(mostRecentCheck([{ lastCheckedAt: null }, { lastCheckedAt: null }])).toBeNull()
  })

  it('returns null for empty list', () => {
    expect(mostRecentCheck([])).toBeNull()
  })
})

describe('componentLabel', () => {
  it('returns project name for uptime component (primary, named after project)', () => {
    expect(componentLabel('uptime', 'My API')).toBe('My API')
  })

  it('returns "Domain & SSL" for domain monitors', () => {
    expect(componentLabel('domain', 'My API')).toBe('Domain & SSL')
  })

  it('returns "Web Vitals" for web_vitals monitors', () => {
    expect(componentLabel('web_vitals', 'My API')).toBe('Web Vitals')
  })

  it('returns "Security Re-scan" for rescan monitors', () => {
    expect(componentLabel('rescan', 'My API')).toBe('Security Re-scan')
  })
})

describe('sortComponents', () => {
  it('puts uptime first, then domain, web_vitals, rescan', () => {
    const result = sortComponents([
      { type: 'rescan', name: 'r' },
      { type: 'uptime', name: 'u' },
      { type: 'web_vitals', name: 'w' },
      { type: 'domain', name: 'd' },
    ])
    expect(result.map((c) => c.type)).toEqual(['uptime', 'domain', 'web_vitals', 'rescan'])
  })

  it('does not mutate the input', () => {
    const input = [{ type: 'rescan', name: 'r' }]
    const copy = [...input]
    sortComponents(input)
    expect(input).toEqual(copy)
  })

  it('handles empty list', () => {
    expect(sortComponents([])).toEqual([])
  })

  it('handles single-element list', () => {
    expect(sortComponents([{ type: 'uptime', name: 'u' }])).toEqual([{ type: 'uptime', name: 'u' }])
  })
})

/* -------------------------------------------------------------------------- */
/* getPublicStatus orchestrator (mocked DB)                                    */
/* -------------------------------------------------------------------------- */

describe('getPublicStatus', () => {
  let mockFindFirst: ReturnType<typeof vi.fn>
  let mockSelect: ReturnType<typeof vi.fn>
  let mockQueryFindMany: ReturnType<typeof vi.fn>
  let mockFrom: ReturnType<typeof vi.fn>
  let mockWhere: ReturnType<typeof vi.fn>
  let mockOrderBy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    mockFindFirst = vi.fn()
    mockQueryFindMany = vi.fn()
    mockOrderBy = vi.fn(() => Promise.resolve([]))
    mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }))
    mockFrom = vi.fn(() => ({ where: mockWhere }))
    mockSelect = vi.fn(() => ({ from: mockFrom }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when the slug does not resolve to a project', async () => {
    mockFindFirst.mockResolvedValue(null)

    vi.doMock('../src/client.ts', () => ({
      db: {
        query: {
          projects: { findFirst: mockFindFirst },
        },
      },
    }))

    const { getPublicStatus: fn } = await import('../src/queries/monitors.ts')
    expect(await fn('missing-slug')).toBeNull()
  })

  it('returns a project with zero components when no monitors are enabled', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'p1', name: 'My App', url: 'https://example.com' })
    // select(...).from(monitors).where(...).orderBy(...) → []
    mockOrderBy.mockResolvedValueOnce([])

    vi.doMock('../src/client.ts', () => ({
      db: {
        query: { projects: { findFirst: mockFindFirst } },
        select: mockSelect,
      },
    }))

    const { getPublicStatus: fn } = await import('../src/queries/monitors.ts')
    const result = await fn('my-slug')

    expect(result).not.toBeNull()
    expect(result!.projectName).toBe('My App')
    expect(result!.components).toEqual([])
    expect(result!.overallStatus).toBe('unknown') // no components → unknown
    expect(result!.uptimePercent).toBeNull()
    expect(result!.lastCheckedAt).toBeNull()
  })

  it('aggregates overallStatus as worst-of across components', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'p1', name: 'My App', url: 'https://example.com' })
    mockOrderBy.mockResolvedValueOnce([
      { id: 'm-up', type: 'uptime', lastStatus: 'up', lastRunAt: new Date(), intervalS: 60 },
      { id: 'm-dom', type: 'domain', lastStatus: 'down', lastRunAt: new Date(), intervalS: 86400 },
    ])

    vi.doMock('../src/client.ts', () => ({
      db: {
        query: {
          projects: { findFirst: mockFindFirst },
          incidents: { findMany: vi.fn().mockResolvedValue([]) },
        },
        select: mockSelect,
      },
    }))

    // Mock the dynamic imports of rollups + maintenance-windows
    vi.doMock('../src/queries/rollups.ts', () => ({
      getUptimeFromDailyRollups: vi.fn().mockResolvedValue({ uptimePercent: 99.9 }),
      getDailyBucketsFromRollups: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock('../src/queries/maintenance-windows.ts', () => ({
      getActiveMaintenanceWindow: vi.fn().mockResolvedValue(null),
    }))

    const { getPublicStatus: fn } = await import('../src/queries/monitors.ts')
    const result = await fn('my-slug')

    expect(result!.components).toHaveLength(2)
    expect(result!.overallStatus).toBe('failed') // worst-of: domain is down
  })

  it('returns "ok" only when ALL components are ok', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'p1', name: 'My App', url: 'https://example.com' })
    mockOrderBy.mockResolvedValueOnce([
      { id: 'm-up', type: 'uptime', lastStatus: 'up', lastRunAt: new Date(), intervalS: 60 },
      { id: 'm-dom', type: 'domain', lastStatus: 'up', lastRunAt: new Date(), intervalS: 86400 },
    ])

    vi.doMock('../src/client.ts', () => ({
      db: {
        query: {
          projects: { findFirst: mockFindFirst },
          incidents: { findMany: vi.fn().mockResolvedValue([]) },
        },
        select: mockSelect,
      },
    }))
    vi.doMock('../src/queries/rollups.ts', () => ({
      getUptimeFromDailyRollups: vi.fn().mockResolvedValue({ uptimePercent: 99.99 }),
      getDailyBucketsFromRollups: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock('../src/queries/maintenance-windows.ts', () => ({
      getActiveMaintenanceWindow: vi.fn().mockResolvedValue(null),
    }))

    const { getPublicStatus: fn } = await import('../src/queries/monitors.ts')
    const result = await fn('my-slug')
    expect(result!.overallStatus).toBe('ok')
  })

  it('returns "unknown" when nothing failed but at least one is unknown', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'p1', name: 'My App', url: 'https://example.com' })
    mockOrderBy.mockResolvedValueOnce([
      { id: 'm-up', type: 'uptime', lastStatus: 'up', lastRunAt: new Date(), intervalS: 60 },
      { id: 'm-dom', type: 'domain', lastStatus: null, lastRunAt: null, intervalS: 86400 },
    ])

    vi.doMock('../src/client.ts', () => ({
      db: {
        query: {
          projects: { findFirst: mockFindFirst },
          incidents: { findMany: vi.fn().mockResolvedValue([]) },
        },
        select: mockSelect,
      },
    }))
    vi.doMock('../src/queries/rollups.ts', () => ({
      getUptimeFromDailyRollups: vi.fn().mockResolvedValue({ uptimePercent: 100 }),
      getDailyBucketsFromRollups: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock('../src/queries/maintenance-windows.ts', () => ({
      getActiveMaintenanceWindow: vi.fn().mockResolvedValue(null),
    }))

    const { getPublicStatus: fn } = await import('../src/queries/monitors.ts')
    const result = await fn('my-slug')
    expect(result!.overallStatus).toBe('unknown')
  })

  it('flags a stale monitor as unknown regardless of lastStatus', async () => {
    // lastRunAt older than 3× intervalS (60s × 3 = 180s)
    const staleRunAt = new Date(Date.now() - 10 * 60 * 1000)
    mockFindFirst.mockResolvedValueOnce({ id: 'p1', name: 'My App', url: 'https://example.com' })
    mockOrderBy.mockResolvedValueOnce([
      { id: 'm-up', type: 'uptime', lastStatus: 'up', lastRunAt: staleRunAt, intervalS: 60 },
    ])

    vi.doMock('../src/client.ts', () => ({
      db: {
        query: {
          projects: { findFirst: mockFindFirst },
          incidents: { findMany: vi.fn().mockResolvedValue([]) },
        },
        select: mockSelect,
      },
    }))
    vi.doMock('../src/queries/rollups.ts', () => ({
      getUptimeFromDailyRollups: vi.fn().mockResolvedValue({ uptimePercent: 99 }),
      getDailyBucketsFromRollups: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock('../src/queries/maintenance-windows.ts', () => ({
      getActiveMaintenanceWindow: vi.fn().mockResolvedValue(null),
    }))

    const { getPublicStatus: fn } = await import('../src/queries/monitors.ts')
    const result = await fn('my-slug')

    expect(result!.components[0].currentStatus).toBe('unknown')
    expect(result!.overallStatus).toBe('unknown')
  })

  it('sorts components: uptime first, then domain, web_vitals, rescan', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'p1', name: 'My App', url: 'https://example.com' })
    // DB returns in whatever order; we want the page to enforce the display order
    mockOrderBy.mockResolvedValueOnce([
      { id: 'm-rescan', type: 'rescan', lastStatus: 'up', lastRunAt: new Date(), intervalS: 86400 },
      { id: 'm-wv', type: 'web_vitals', lastStatus: 'up', lastRunAt: new Date(), intervalS: 86400 },
      { id: 'm-up', type: 'uptime', lastStatus: 'up', lastRunAt: new Date(), intervalS: 60 },
      { id: 'm-dom', type: 'domain', lastStatus: 'up', lastRunAt: new Date(), intervalS: 86400 },
    ])

    vi.doMock('../src/client.ts', () => ({
      db: {
        query: {
          projects: { findFirst: mockFindFirst },
          incidents: { findMany: vi.fn().mockResolvedValue([]) },
        },
        select: mockSelect,
      },
    }))
    vi.doMock('../src/queries/rollups.ts', () => ({
      getUptimeFromDailyRollups: vi.fn().mockResolvedValue({ uptimePercent: 99 }),
      getDailyBucketsFromRollups: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock('../src/queries/maintenance-windows.ts', () => ({
      getActiveMaintenanceWindow: vi.fn().mockResolvedValue(null),
    }))

    const { getPublicStatus: fn } = await import('../src/queries/monitors.ts')
    const result = await fn('my-slug')

    expect(result!.components.map((c) => c.type)).toEqual([
      'uptime',
      'domain',
      'web_vitals',
      'rescan',
    ])
  })

  it('returns 90-day strip buckets for uptime components only', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'p1', name: 'My App', url: 'https://example.com' })
    mockOrderBy.mockResolvedValueOnce([
      { id: 'm-up', type: 'uptime', lastStatus: 'up', lastRunAt: new Date(), intervalS: 60 },
      { id: 'm-dom', type: 'domain', lastStatus: 'up', lastRunAt: new Date(), intervalS: 86400 },
    ])

    const buckets = [{ date: '2025-01-15', ok: true, total: 24 }]

    vi.doMock('../src/client.ts', () => ({
      db: {
        query: {
          projects: { findFirst: mockFindFirst },
          incidents: { findMany: vi.fn().mockResolvedValue([]) },
        },
        select: mockSelect,
      },
    }))
    vi.doMock('../src/queries/rollups.ts', () => ({
      getUptimeFromDailyRollups: vi.fn().mockResolvedValue({ uptimePercent: 99 }),
      getDailyBucketsFromRollups: vi.fn().mockResolvedValue(buckets),
    }))
    vi.doMock('../src/queries/maintenance-windows.ts', () => ({
      getActiveMaintenanceWindow: vi.fn().mockResolvedValue(null),
    }))

    const { getPublicStatus: fn } = await import('../src/queries/monitors.ts')
    const result = await fn('my-slug')

    const uptime = result!.components.find((c) => c.type === 'uptime')
    const domain = result!.components.find((c) => c.type === 'domain')
    expect(uptime?.dailyBuckets).toEqual(buckets)
    expect(domain?.dailyBuckets).toEqual([]) // non-uptime: empty array
  })

  it('attaches an active maintenance window to the matching component', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'p1', name: 'My App', url: 'https://example.com' })
    mockOrderBy.mockResolvedValueOnce([
      { id: 'm-up', type: 'uptime', lastStatus: 'up', lastRunAt: new Date(), intervalS: 60 },
    ])

    vi.doMock('../src/client.ts', () => ({
      db: {
        query: {
          projects: { findFirst: mockFindFirst },
          incidents: { findMany: vi.fn().mockResolvedValue([]) },
        },
        select: mockSelect,
      },
    }))
    vi.doMock('../src/queries/rollups.ts', () => ({
      getUptimeFromDailyRollups: vi.fn().mockResolvedValue({ uptimePercent: 99 }),
      getDailyBucketsFromRollups: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock('../src/queries/maintenance-windows.ts', () => ({
      getActiveMaintenanceWindow: vi.fn().mockResolvedValue({
        dayOfWeek: null,
        startTime: '02:00:00',
        durationMin: 120,
        timezone: 'UTC',
        reason: 'DB maintenance',
      }),
    }))

    const { getPublicStatus: fn } = await import('../src/queries/monitors.ts')
    const result = await fn('my-slug')

    expect(result!.components[0].maintenance).toEqual({
      description: expect.stringContaining('02:00'),
      reason: 'DB maintenance',
    })
  })

  it('attaches per-component incidents', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 'p1', name: 'My App', url: 'https://example.com' })
    mockOrderBy.mockResolvedValueOnce([
      { id: 'm-up', type: 'uptime', lastStatus: 'up', lastRunAt: new Date(), intervalS: 60 },
    ])

    const incidents = [
      { startedAt: new Date(), resolvedAt: new Date(), durationMs: 1000, statusCode: 500, detail: 'oops' },
    ]

    vi.doMock('../src/client.ts', () => ({
      db: {
        query: {
          projects: { findFirst: mockFindFirst },
          incidents: { findMany: vi.fn().mockResolvedValue(incidents) },
        },
        select: mockSelect,
      },
    }))
    vi.doMock('../src/queries/rollups.ts', () => ({
      getUptimeFromDailyRollups: vi.fn().mockResolvedValue({ uptimePercent: 99 }),
      getDailyBucketsFromRollups: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock('../src/queries/maintenance-windows.ts', () => ({
      getActiveMaintenanceWindow: vi.fn().mockResolvedValue(null),
    }))

    const { getPublicStatus: fn } = await import('../src/queries/monitors.ts')
    const result = await fn('my-slug')
    expect(result!.components[0].recentIncidents).toHaveLength(1)
    expect(result!.components[0].recentIncidents[0].statusCode).toBe(500)
  })
})
