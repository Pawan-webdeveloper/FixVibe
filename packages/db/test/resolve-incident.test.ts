import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveIncident } from '../src/queries/monitors'

// Mock the db module
vi.mock('../src/client', () => ({
  db: {
    query: {
      incidents: {
        findMany: vi.fn(),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
  },
}))

import { db } from '../src/client'

describe('resolveIncident', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns resolved incidents with duration info', async () => {
    // Arrange
    const now = new Date()
    const startedAt = new Date(now.getTime() - 5 * 60 * 1000) // 5 minutes ago
    const mockIncidents = [
      {
        id: 'incident-1',
        monitorId: 'mon-1',
        startedAt,
        resolvedAt: null,
        statusCode: 503,
        detail: 'Service Unavailable',
      },
    ]
    vi.mocked(db.query.incidents.findMany).mockResolvedValue(mockIncidents)

    const mockSet = vi.fn()
    const mockWhere = vi.fn()
    vi.mocked(db.update).mockReturnValue({ set: mockSet } as any)
    mockSet.mockReturnValue({ where: mockWhere })

    // Act
    const result = await resolveIncident('mon-1')

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('incident-1')
    expect(result[0].statusCode).toBe(503)
    expect(result[0].detail).toBe('Service Unavailable')
    expect(result[0].durationMs).toBeGreaterThan(0)
    expect(result[0].startedAt).toBe(startedAt)
  })

  it('returns empty array when no open incidents exist', async () => {
    // Arrange
    vi.mocked(db.query.incidents.findMany).mockResolvedValue([])

    // Act
    const result = await resolveIncident('mon-1')

    // Assert
    expect(result).toEqual([])
    expect(db.update).not.toHaveBeenCalled()
  })

  it('resolves multiple incidents and returns all', async () => {
    // Arrange
    const now = new Date()
    const mockIncidents = [
      {
        id: 'incident-1',
        monitorId: 'mon-1',
        startedAt: new Date(now.getTime() - 10 * 60 * 1000),
        resolvedAt: null,
        statusCode: 500,
        detail: 'Internal Server Error',
      },
      {
        id: 'incident-2',
        monitorId: 'mon-1',
        startedAt: new Date(now.getTime() - 5 * 60 * 1000),
        resolvedAt: null,
        statusCode: 502,
        detail: 'Bad Gateway',
      },
    ]
    vi.mocked(db.query.incidents.findMany).mockResolvedValue(mockIncidents)

    const mockSet = vi.fn()
    const mockWhere = vi.fn()
    vi.mocked(db.update).mockReturnValue({ set: mockSet } as any)
    mockSet.mockReturnValue({ where: mockWhere })

    // Act
    const result = await resolveIncident('mon-1')

    // Assert
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('incident-1')
    expect(result[1].id).toBe('incident-2')
    expect(db.update).toHaveBeenCalledTimes(2)
  })
})