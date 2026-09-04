import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanupOldMonitorData } from '../src/queries/monitors'

// Mock the db module
vi.mock('../src/client', () => ({
  db: {
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([]),
      })),
    })),
  },
}))

import { db } from '../src/client'

describe('cleanupOldMonitorData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes old DNS snapshots', async () => {
    // Arrange
    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
      }),
    } as any)

    // Act
    const result = await cleanupOldMonitorData()

    // Assert
    expect(result.dnsSnapshotsDeleted).toBe(2)
  })

  it('deletes old monitor events', async () => {
    // Arrange
    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
    } as any)

    // Act
    const result = await cleanupOldMonitorData()

    // Assert
    expect(result.monitorEventsDeleted).toBe(1)
  })

  it('deletes old web vitals snapshots', async () => {
    // Arrange
    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]),
      }),
    } as any)

    // Act
    const result = await cleanupOldMonitorData()

    // Assert
    expect(result.webVitalsSnapshotsDeleted).toBe(3)
  })

  it('returns zero counts when no data is deleted', async () => {
    // Arrange
    vi.mocked(db.delete).mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    } as any)

    // Act
    const result = await cleanupOldMonitorData()

    // Assert
    expect(result.dnsSnapshotsDeleted).toBe(0)
    expect(result.monitorEventsDeleted).toBe(0)
    expect(result.webVitalsSnapshotsDeleted).toBe(0)
  })
})