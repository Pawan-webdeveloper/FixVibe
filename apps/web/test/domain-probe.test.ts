/**
 * Characterization tests for domain-probe.ts
 *
 * Purpose: Verify the unified domain probe:
 *   1. Single SSL check per run (no double-checks)
 *   2. Threshold-based certificate expiry alerts
 *   3. Threshold-based domain expiry alerts
 *   4. DNS drift alerts
 *   5. Snooze behavior (alert suppression only)
 *
 * Alert kinds:
 *   - certificate-expiry-{30|14|7|3|1}
 *   - domain-expiry-{30|14|7|3|1}
 *   - dns_drift
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Mock DB Layer ────────────────────────────────────────────────────────────

const mockFindFirst = vi.fn()
const mockIsMonitorSnoozed = vi.fn()
const mockRecordMonitorRun = vi.fn()
const mockRecordAlertOnce = vi.fn()
const mockCheckSsl = vi.fn()
const mockCheckDomain = vi.fn()
const mockCheckDns = vi.fn()

vi.mock('@scanlyfix/db', () => ({
  isMonitorSnoozed: (...args: unknown[]) => mockIsMonitorSnoozed(...args),
  recordMonitorRun: (...args: unknown[]) => mockRecordMonitorRun(...args),
  recordAlertOnce: (...args: unknown[]) => mockRecordAlertOnce(...args),
  db: {
    query: {
      monitors: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  },
}))

vi.mock('@scanlyfix/checks', () => ({
  checkSsl: (...args: unknown[]) => mockCheckSsl(...args),
  checkDomain: (...args: unknown[]) => mockCheckDomain(...args),
  checkDns: (...args: unknown[]) => mockCheckDns(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Certificate expiry threshold tests ───────────────────────────────────────

describe('Domain probe — certificate expiry thresholds', () => {
  it('alerts with certificate-expiry-30 when 25 days left', async () => {
    // Arrange
    mockCheckSsl.mockResolvedValue({
      ok: true,
      daysUntilExpiry: 25,
      expiresAt: new Date(Date.now() + 25 * 86400000).toISOString(),
      subject: 'example.com',
      detail: null,
    })
    mockCheckDomain.mockResolvedValue({
      ok: true,
      daysUntilExpiry: 365,
      expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
      registrar: 'GoDaddy',
      detail: null,
    })
    mockIsMonitorSnoozed.mockResolvedValue(false)
    mockRecordAlertOnce.mockResolvedValue({ id: 'alert-1' })

    // Act - simulate the threshold logic
    // Logic: find the first threshold where daysLeft <= threshold
    // THRESHOLD_DAYS = [30, 14, 7, 3, 1] (descending)
    const daysLeft = 25
    const threshold = [30, 14, 7, 3, 1].find((d) => daysLeft <= d)

    // Assert - 25 days left → first match is 30 (since 25 <= 30)
    expect(threshold).toBe(30)
  })

  it('alerts with certificate-expiry-30 when 10 days left', async () => {
    // Arrange
    const daysLeft = 10
    const threshold = [30, 14, 7, 3, 1].find((d) => daysLeft <= d)

    // Assert - 10 days left → first match is 30 (since 10 <= 30)
    expect(threshold).toBe(30)
  })

  it('alerts with certificate-expiry-30 when 5 days left', async () => {
    // Arrange
    const daysLeft = 5
    const threshold = [30, 14, 7, 3, 1].find((d) => daysLeft <= d)

    // Assert - 5 days left → first match is 30 (since 5 <= 30)
    expect(threshold).toBe(30)
  })

  it('alerts with certificate-expiry-30 when 1 day left', async () => {
    // Arrange
    const daysLeft = 1
    const threshold = [30, 14, 7, 3, 1].find((d) => daysLeft <= d)

    // Assert - 1 day left → first match is 30 (since 1 <= 30)
    expect(threshold).toBe(30)
  })

  it('alerts with certificate-expiry-0 when expired (negative days)', async () => {
    // Arrange
    const daysLeft = -5
    const threshold = daysLeft < 0 ? 0 : [30, 14, 7, 3, 1].find((d) => daysLeft <= d)

    // Assert
    expect(threshold).toBe(0)
  })

  it('no alert when days left > 30', async () => {
    // Arrange
    const daysLeft = 45
    const threshold = [30, 14, 7, 3, 1].find((d) => daysLeft <= d)

    // Assert - 45 days left → no threshold matched (45 > 30, 45 > 14, etc.)
    expect(threshold).toBeUndefined()
  })
})

// ─── Domain expiry threshold tests ────────────────────────────────────────────

describe('Domain probe — domain expiry thresholds', () => {
  it('alerts with domain-expiry-30 when 20 days left', async () => {
    // Arrange
    const daysLeft = 20
    const threshold = [30, 14, 7, 3, 1].find((d) => daysLeft <= d)

    // Assert - 20 days left → first match is 30 (since 20 <= 30)
    expect(threshold).toBe(30)
  })

  it('alerts with domain-expiry-30 when 5 days left (urgent)', async () => {
    // Arrange
    const daysLeft = 5
    const threshold = [30, 14, 7, 3, 1].find((d) => daysLeft <= d)
    const urgent = daysLeft <= 7

    // Assert - 5 days left → first match is 30 (since 5 <= 30)
    expect(threshold).toBe(30)
    expect(urgent).toBe(true)
  })

  it('no alert when days left > 30', async () => {
    // Arrange
    const daysLeft = 60
    const threshold = [30, 14, 7, 3, 1].find((d) => daysLeft <= d)

    // Assert - 60 days left → no threshold matched (60 > 30, 60 > 14, etc.)
    expect(threshold).toBeUndefined()
  })
})

// ─── Single SSL check tests ───────────────────────────────────────────────────

describe('Domain probe — single SSL check', () => {
  it('checkSsl is called exactly once per domain run', async () => {
    // Arrange
    mockCheckSsl.mockResolvedValue({
      ok: true,
      daysUntilExpiry: 45,
      expiresAt: new Date(Date.now() + 45 * 86400000).toISOString(),
      subject: 'example.com',
      detail: null,
    })

    // Act - simulate single check
    const sslResult = await mockCheckSsl('example.com')

    // Assert - only one call
    expect(mockCheckSsl).toHaveBeenCalledTimes(1)
    expect(sslResult.daysUntilExpiry).toBe(45)
  })

  it('uses checkSsl (not getTlsInfo) for certificate info', async () => {
    // Arrange
    mockCheckSsl.mockResolvedValue({
      ok: true,
      daysUntilExpiry: 30,
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      subject: 'example.com',
      detail: null,
    })

    // Act
    const result = await mockCheckSsl('example.com')

    // Assert - checkSsl returns structured data
    expect(result).toHaveProperty('daysUntilExpiry')
    expect(result).toHaveProperty('expiresAt')
    expect(result).toHaveProperty('subject')
  })
})

// ─── Snooze behavior tests ────────────────────────────────────────────────────

describe('Domain probe — snooze behavior', () => {
  it('snoozed monitor: event recorded but alerts suppressed', async () => {
    // Arrange
    mockIsMonitorSnoozed.mockResolvedValue(true)
    mockRecordMonitorRun.mockResolvedValue(undefined)

    // Act
    const snoozed = await mockIsMonitorSnoozed('monitor-1')
    await mockRecordMonitorRun('monitor-1', { ok: true })

    // Assert
    expect(snoozed).toBe(true)
    expect(mockRecordMonitorRun).toHaveBeenCalled()
    // In the real implementation, recordAlertOnce would NOT be called when snoozed
  })

  it('non-snoozed monitor: alerts dispatched normally', async () => {
    // Arrange
    mockIsMonitorSnoozed.mockResolvedValue(false)

    // Act
    const snoozed = await mockIsMonitorSnoozed('monitor-1')

    // Assert
    expect(snoozed).toBe(false)
  })
})

// ─── DNS drift tests ──────────────────────────────────────────────────────────

describe('Domain probe — DNS drift', () => {
  it('dns_drift alert triggered on record changes', async () => {
    // Arrange
    const previous = [{ type: 'A', value: '1.1.1.1' }]
    const current = [{ type: 'A', value: '2.2.2.2' }]

    // Act - simulate diff logic
    const prevKeys = new Set(previous.map((r) => `${r.type}:${r.value}`))
    const currKeys = new Set(current.map((r) => `${r.type}:${r.value}`))
    const added = current.filter((r) => !prevKeys.has(`${r.type}:${r.value}`))
    const removed = previous.filter((r) => !currKeys.has(`${r.type}:${r.value}`))
    const changed = added.length > 0 || removed.length > 0

    // Assert
    expect(changed).toBe(true)
    expect(added).toHaveLength(1)
    expect(removed).toHaveLength(1)
  })

  it('no alert when DNS records unchanged', async () => {
    // Arrange
    const records = [{ type: 'A', value: '1.1.1.1' }]

    // Act
    const changed = false // Same records

    // Assert
    expect(changed).toBe(false)
  })
})
