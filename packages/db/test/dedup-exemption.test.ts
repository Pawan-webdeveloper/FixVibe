/**
 * Tests for recordAlertOnce dedup exemption.
 *
 * Verifies that:
 *   1. Downtime alerts (state-transition) are exempt from daily dedup
 *   2. Recovery alerts (state-transition) are exempt from daily dedup
 *   3. Other alert kinds still have daily dedup
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

describe('recordAlertOnce — dedup exemption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('downtime alerts are exempt from dedup (state-transition)', async () => {
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

  it('recovery alerts are exempt from dedup (state-transition)', async () => {
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
})
