/**
 * Tests for recordAlertOnce dedup with dedupKey.
 *
 * Verifies that:
 *   1. Downtime alerts (state-transition) are exempt from daily dedup
 *   2. Recovery alerts are exempt from daily dedup
 *   3. Reminder alerts use dedupKey for dedup
 *   4. Other alert kinds still have daily dedup
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the db module
vi.mock('../src/client', () => ({
  db: {
    query: {
      alerts: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'alert-1' }]),
      })),
    })),
  },
}))

import { recordAlertOnce } from '../src/queries/alerts'
import { db } from '../src/client'

describe('recordAlertOnce — dedup logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('downtime alerts are exempt from daily dedup (state-transition)', async () => {
    // Arrange — simulate existing alert for downtime kind
    vi.mocked(db.query.alerts.findFirst).mockResolvedValue({ id: 'existing-alert' })

    // Act
    const result = await recordAlertOnce({
      projectId: 'proj-1',
      kind: 'downtime',
      channel: 'email',
      payload: { streak: 2 },
    })

    // Assert — should NOT check for existing alerts (dedup exempt)
    expect(db.query.alerts.findFirst).not.toHaveBeenCalled()
    // Should still insert a new alert
    expect(db.insert).toHaveBeenCalled()
    expect(result).toEqual({ id: 'alert-1' })
  })

  it('recovery alerts are exempt from daily dedup (state-transition)', async () => {
    // Arrange — simulate existing alert for recovery kind
    vi.mocked(db.query.alerts.findFirst).mockResolvedValue({ id: 'existing-alert' })

    // Act
    const result = await recordAlertOnce({
      projectId: 'proj-1',
      kind: 'recovered',
      channel: 'email',
      payload: { downFor: '5m' },
    })

    // Assert — should NOT check for existing alerts (dedup exempt)
    expect(db.query.alerts.findFirst).not.toHaveBeenCalled()
    // Should still insert a new alert
    expect(db.insert).toHaveBeenCalled()
    expect(result).toEqual({ id: 'alert-1' })
  })

  it('reminder alerts use dedupKey for dedup', async () => {
    // Arrange — simulate existing alert with same dedupKey
    vi.mocked(db.query.alerts.findFirst).mockResolvedValue({ id: 'existing-alert' })

    // Act
    const result = await recordAlertOnce({
      projectId: 'proj-1',
      kind: 'downtime-reminder',
      channel: 'email',
      payload: { downFor: '30m', reminderNumber: 1 },
      dedupKey: 'downtime-mon-1-inc-1-reminder-1',
    })

    // Assert — should check for existing alerts with dedupKey
    expect(db.query.alerts.findFirst).toHaveBeenCalledWith({
      where: expect.anything(),
      columns: { id: true },
    })
    // Should NOT insert a new alert (dedup)
    expect(db.insert).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('reminder alerts with different dedupKey are allowed', async () => {
    // Arrange — no existing alert with this dedupKey
    vi.mocked(db.query.alerts.findFirst).mockResolvedValue(null)

    // Act
    const result = await recordAlertOnce({
      projectId: 'proj-1',
      kind: 'downtime-reminder',
      channel: 'email',
      payload: { downFor: '1h', reminderNumber: 2 },
      dedupKey: 'downtime-mon-1-inc-1-reminder-2',
    })

    // Assert — should check for existing alerts with dedupKey
    expect(db.query.alerts.findFirst).toHaveBeenCalled()
    // Should insert a new alert
    expect(db.insert).toHaveBeenCalled()
    expect(result).toEqual({ id: 'alert-1' })
  })

  it('certificate expiry alerts have daily dedup', async () => {
    // Arrange
    vi.mocked(db.query.alerts.findFirst).mockResolvedValue(null)

    // Act
    const result = await recordAlertOnce({
      projectId: 'proj-1',
      kind: 'certificate-expiry-7',
      channel: 'email',
      payload: { daysLeft: 7 },
    })

    // Assert
    expect(db.query.alerts.findFirst).toHaveBeenCalled()
    expect(db.insert).toHaveBeenCalled()
  })

  it('dns drift alerts have daily dedup', async () => {
    // Arrange
    vi.mocked(db.query.alerts.findFirst).mockResolvedValue(null)

    // Act
    const result = await recordAlertOnce({
      projectId: 'proj-1',
      kind: 'dns_drift',
      channel: 'email',
      payload: { added: [], removed: [] },
    })

    // Assert
    expect(db.query.alerts.findFirst).toHaveBeenCalled()
    expect(db.insert).toHaveBeenCalled()
  })

  it('web vitals alerts have daily dedup', async () => {
    // Arrange
    vi.mocked(db.query.alerts.findFirst).mockResolvedValue(null)

    // Act
    const result = await recordAlertOnce({
      projectId: 'proj-1',
      kind: 'web_vitals',
      channel: 'email',
      payload: { violations: [] },
    })

    // Assert
    expect(db.query.alerts.findFirst).toHaveBeenCalled()
    expect(db.insert).toHaveBeenCalled()
  })

  it('score drop alerts have daily dedup', async () => {
    // Arrange
    vi.mocked(db.query.alerts.findFirst).mockResolvedValue(null)

    // Act
    const result = await recordAlertOnce({
      projectId: 'proj-1',
      kind: 'score-drop',
      channel: 'email',
      payload: { before: 90, after: 80 },
    })

    // Assert
    expect(db.query.alerts.findFirst).toHaveBeenCalled()
    expect(db.insert).toHaveBeenCalled()
  })
})
