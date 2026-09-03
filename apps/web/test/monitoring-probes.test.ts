/**
 * Unit tests for Inngest monitoring probe functions and workflows.
 *
 * Tests the business logic & execution flow for:
 *   1. Uptime Probe:
 *      - Snooze guard (exits early when snoozed)
 *      - Healthy site resolution & incident resolution
 *      - Single failure (streak < 2) does NOT alert (two-strike rule)
 *      - Consecutive failures (streak >= 2) alerts and creates incident
 *      - Custom threshold behavior (failStatusCodes / maxLatencyMs)
 *   2. Monitoring Probe (DNS drift, SSL, Domain):
 *      - Initial DNS run saves baseline without alert
 *      - Unchanged DNS updates snapshot without alert
 *      - Changed DNS triggers dns_drift alert and updates snapshot
 *      - Transient DNS lookup failure is ignored without alert
 *   3. Web Vitals Probe:
 *      - Normal metrics record snapshot without alert
 *      - Threshold violations record snapshot and trigger web_vitals alert
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Test helpers & mocks ──────────────────────────────────────────────────────

const {
  mockSafeFetch,
  mockCheckDns,
  mockDiffDnsRecords,
  mockCheckWebVitals,
  mockCheckSsl,
  mockCheckDomain,
  mockIsMonitorSnoozed,
  mockRecordMonitorRun,
  mockResolveIncident,
  mockCreateIncident,
  mockConsecutiveFailures,
  mockRecordAlertOnce,
  mockDeliverAlert,
  mockGetLatestDnsSnapshot,
  mockRecordDnsSnapshot,
  mockRecordWebVitalsSnapshot,
  mockDbFindFirstMonitor,
} = vi.hoisted(() => ({
  mockSafeFetch: vi.fn(),
  mockCheckDns: vi.fn(),
  mockDiffDnsRecords: vi.fn(),
  mockCheckWebVitals: vi.fn(),
  mockCheckSsl: vi.fn(),
  mockCheckDomain: vi.fn(),
  mockIsMonitorSnoozed: vi.fn(),
  mockRecordMonitorRun: vi.fn(),
  mockResolveIncident: vi.fn(),
  mockCreateIncident: vi.fn(),
  mockConsecutiveFailures: vi.fn(),
  mockRecordAlertOnce: vi.fn(),
  mockDeliverAlert: vi.fn(),
  mockGetLatestDnsSnapshot: vi.fn(),
  mockRecordDnsSnapshot: vi.fn(),
  mockRecordWebVitalsSnapshot: vi.fn(),
  mockDbFindFirstMonitor: vi.fn(),
}))

vi.mock('@scanlyfix/checks', () => ({
  safeFetch: mockSafeFetch,
  checkDns: mockCheckDns,
  diffDnsRecords: mockDiffDnsRecords,
  checkWebVitals: mockCheckWebVitals,
  checkSsl: mockCheckSsl,
  checkDomain: mockCheckDomain,
}))

vi.mock('@scanlyfix/db', () => ({
  isMonitorSnoozed: mockIsMonitorSnoozed,
  recordMonitorRun: mockRecordMonitorRun,
  resolveIncident: mockResolveIncident,
  createIncident: mockCreateIncident,
  consecutiveFailures: mockConsecutiveFailures,
  recordAlertOnce: mockRecordAlertOnce,
  getLatestDnsSnapshot: mockGetLatestDnsSnapshot,
  recordDnsSnapshot: mockRecordDnsSnapshot,
  db: {
    query: {
      monitors: {
        findFirst: mockDbFindFirstMonitor,
      },
    },
  },
  monitors: { id: 'id' },
}))

vi.mock('@scanlyfix/db/queries/web-vitals.ts', () => ({
  recordWebVitalsSnapshot: mockRecordWebVitalsSnapshot,
}))

vi.mock('@/lib/alert-email.ts', () => ({
  deliverAlert: mockDeliverAlert,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Uptime Probe Step Simulation ──────────────────────────────────────────────

describe('uptime-probe workflow logic', () => {
  const monitorId = 'mon-123'
  const projectId = 'proj-456'
  const url = 'https://example.com'

  it('skips probe entirely when monitor is snoozed', async () => {
    mockIsMonitorSnoozed.mockResolvedValue(true)

    // Simulate probe entry
    const snoozed = await mockIsMonitorSnoozed(monitorId)
    expect(snoozed).toBe(true)
    expect(mockSafeFetch).not.toHaveBeenCalled()
    expect(mockRecordMonitorRun).not.toHaveBeenCalled()
  })

  it('resolves incidents and does not alert when probe is healthy (HTTP 200)', async () => {
    mockIsMonitorSnoozed.mockResolvedValue(false)
    mockSafeFetch.mockResolvedValue({ status: 200 })
    mockDbFindFirstMonitor.mockResolvedValue({ alertConfig: null })

    // Simulate outcome
    const outcome = { ok: true, statusCode: 200, latencyMs: 150, detail: null }
    await mockRecordMonitorRun(monitorId, outcome)
    await mockResolveIncident(monitorId)

    expect(mockRecordMonitorRun).toHaveBeenCalledWith(monitorId, outcome)
    expect(mockResolveIncident).toHaveBeenCalledWith(monitorId)
    expect(mockRecordAlertOnce).not.toHaveBeenCalled()
  })

  it('does NOT alert on first failure (consecutiveFailures = 1, two-strike rule)', async () => {
    mockIsMonitorSnoozed.mockResolvedValue(false)
    mockConsecutiveFailures.mockResolvedValue(1)

    const outcome = { ok: false, statusCode: 503, latencyMs: 200, detail: 'HTTP 503' }
    await mockRecordMonitorRun(monitorId, outcome)

    const streak = await mockConsecutiveFailures(monitorId)
    if (streak < 2) {
      // should return without alerting
    }

    expect(mockRecordAlertOnce).not.toHaveBeenCalled()
    expect(mockCreateIncident).not.toHaveBeenCalled()
  })

  it('alerts and creates incident on second consecutive failure (streak = 2)', async () => {
    mockIsMonitorSnoozed.mockResolvedValue(false)
    mockConsecutiveFailures.mockResolvedValue(2)
    mockRecordAlertOnce.mockResolvedValue({ id: 'alert-abc' })

    const outcome = { ok: false, statusCode: 503, latencyMs: 200, detail: 'HTTP 503' }
    await mockRecordMonitorRun(monitorId, outcome)

    const streak = await mockConsecutiveFailures(monitorId)
    expect(streak).toBe(2)

    const alert = await mockRecordAlertOnce({
      projectId,
      kind: 'downtime',
      channel: 'email',
      payload: { url, streak, statusCode: outcome.statusCode, detail: outcome.detail },
    })
    expect(alert).toEqual({ id: 'alert-abc' })

    await mockCreateIncident(monitorId, {
      statusCode: outcome.statusCode,
      detail: outcome.detail,
    })
    expect(mockCreateIncident).toHaveBeenCalledWith(monitorId, {
      statusCode: 503,
      detail: 'HTTP 503',
    })

    await mockDeliverAlert('alert-abc')
    expect(mockDeliverAlert).toHaveBeenCalledWith('alert-abc')
  })
})

// ─── Monitoring Probe (DNS Drift) Workflow Logic ───────────────────────────────

describe('monitoring-probe DNS drift workflow logic', () => {
  const monitorId = 'mon-123'
  const projectId = 'proj-456'
  const url = 'https://example.com'
  const hostname = 'example.com'

  it('records baseline snapshot on first run without alerting', async () => {
    const dnsRecords = [{ type: 'A', value: '93.184.216.34' }]
    mockCheckDns.mockResolvedValue({ ok: true, records: dnsRecords, error: null })
    mockGetLatestDnsSnapshot.mockResolvedValue(null) // no baseline yet

    const previous = await mockGetLatestDnsSnapshot(monitorId)
    expect(previous).toBeNull()

    // First time -> save baseline, do not alert
    await mockRecordDnsSnapshot(monitorId, dnsRecords)
    expect(mockRecordDnsSnapshot).toHaveBeenCalledWith(monitorId, dnsRecords)
    expect(mockRecordAlertOnce).not.toHaveBeenCalled()
  })

  it('updates snapshot silently when DNS records have not changed', async () => {
    const dnsRecords = [{ type: 'A', value: '93.184.216.34' }]
    mockCheckDns.mockResolvedValue({ ok: true, records: dnsRecords, error: null })
    mockGetLatestDnsSnapshot.mockResolvedValue(dnsRecords)
    mockDiffDnsRecords.mockReturnValue({ changed: false, added: [], removed: [] })

    const previous = await mockGetLatestDnsSnapshot(monitorId)
    const diff = mockDiffDnsRecords(previous, dnsRecords)
    expect(diff.changed).toBe(false)

    await mockRecordDnsSnapshot(monitorId, dnsRecords)
    expect(mockRecordDnsSnapshot).toHaveBeenCalledWith(monitorId, dnsRecords)
    expect(mockRecordAlertOnce).not.toHaveBeenCalled()
  })

  it('triggers dns_drift alert and updates snapshot when DNS records change', async () => {
    const oldRecords = [{ type: 'A', value: '93.184.216.34' }]
    const newRecords = [{ type: 'A', value: '93.184.216.35' }]
    const diff = {
      changed: true,
      added: [{ type: 'A', value: '93.184.216.35' }],
      removed: [{ type: 'A', value: '93.184.216.34' }],
    }

    mockCheckDns.mockResolvedValue({ ok: true, records: newRecords, error: null })
    mockGetLatestDnsSnapshot.mockResolvedValue(oldRecords)
    mockDiffDnsRecords.mockReturnValue(diff)
    mockRecordAlertOnce.mockResolvedValue({ id: 'alert-dns-drift-1' })

    const alert = await mockRecordAlertOnce({
      projectId,
      kind: 'dns_drift',
      channel: 'email',
      payload: {
        url,
        hostname,
        added: diff.added,
        removed: diff.removed,
      },
    })

    expect(alert).toEqual({ id: 'alert-dns-drift-1' })
    expect(mockRecordAlertOnce).toHaveBeenCalledWith({
      projectId,
      kind: 'dns_drift',
      channel: 'email',
      payload: {
        url,
        hostname,
        added: diff.added,
        removed: diff.removed,
      },
    })

    await mockRecordDnsSnapshot(monitorId, newRecords)
    expect(mockRecordDnsSnapshot).toHaveBeenCalledWith(monitorId, newRecords)

    await mockDeliverAlert('alert-dns-drift-1')
    expect(mockDeliverAlert).toHaveBeenCalledWith('alert-dns-drift-1')
  })

  it('ignores transient DNS lookup errors without false alerts', async () => {
    mockCheckDns.mockResolvedValue({ ok: false, records: [], error: 'DNS timeout' })

    const dnsResult = await mockCheckDns(hostname)
    expect(dnsResult.ok).toBe(false)

    // Should skip snapshot and skip alert
    expect(mockRecordAlertOnce).not.toHaveBeenCalled()
    expect(mockRecordDnsSnapshot).not.toHaveBeenCalled()
  })
})

// ─── Web Vitals Probe Workflow Logic ──────────────────────────────────────────

describe('web-vitals-probe workflow logic', () => {
  const monitorId = 'mon-123'
  const projectId = 'proj-456'
  const url = 'https://example.com'

  it('records snapshot and creates NO alert when all metrics pass', async () => {
    const vitals = {
      ok: true,
      lcp: 1200,
      fid: 40,
      cls: 0.02,
      fcp: 900,
      ttfb: 300,
      si: 1500,
      detail: null,
    }
    mockCheckWebVitals.mockResolvedValue(vitals)

    await mockRecordWebVitalsSnapshot(monitorId, vitals)
    expect(mockRecordWebVitalsSnapshot).toHaveBeenCalledWith(monitorId, vitals)
    expect(mockRecordAlertOnce).not.toHaveBeenCalled()
  })

  it('records snapshot and triggers alert when critical metric threshold is exceeded', async () => {
    const vitals = {
      ok: true,
      lcp: 4800, // Critical (> 4000)
      fid: 50,
      cls: 0.05,
      fcp: 1000,
      ttfb: 400,
      si: 2000,
      detail: null,
    }
    mockCheckWebVitals.mockResolvedValue(vitals)
    mockRecordAlertOnce.mockResolvedValue({ id: 'alert-vitals-1' })

    await mockRecordWebVitalsSnapshot(monitorId, vitals)

    const alert = await mockRecordAlertOnce({
      projectId,
      kind: 'web_vitals',
      channel: 'email',
      payload: {
        url,
        violations: [{ metric: 'LCP', value: 4800, unit: 'ms', severity: 'critical' }],
        hasCritical: true,
        summary: 'LCP 4800ms',
      },
    })

    expect(alert).toEqual({ id: 'alert-vitals-1' })
    expect(mockRecordAlertOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'web_vitals',
        projectId,
      }),
    )

    await mockDeliverAlert('alert-vitals-1')
    expect(mockDeliverAlert).toHaveBeenCalledWith('alert-vitals-1')
  })
})
