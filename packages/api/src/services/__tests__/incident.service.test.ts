/**
 * FILE: packages/api/src/services/__tests__/incident.service.test.ts
 *
 * Unit tests for handleMonitorCheck.
 * Uses vitest + a lightweight mock repository pattern.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleMonitorCheck } from '../incident.service'
import * as repo from '../../../../db/src/repositories/incident.repository.ts'

/* ------------------------------------------------------------------ */
/* Mocks                                                               */
/* ------------------------------------------------------------------ */

vi.mock('../../../../db/src/repositories/incident.repository.ts') /* monitor error — fixed mock path to match actual import path */

const mockDb = {} as repo.DB

const baseCheck = {
  monitorId: 'monitor-uuid-1',
  checkedAt: new Date('2025-01-15T10:00:00Z'),
}

const mockOpenIncident: repo.OpenIncident = {
  id: 'incident-uuid-1',
  monitorId: 'monitor-uuid-1',
  startedAt: new Date('2025-01-15T09:00:00Z'),
  resolvedAt: null,
  durationMs: null,
  statusCode: 503,
  detail: 'HTTP 503',
}

/* ------------------------------------------------------------------ */
/* Tests                                                                */
/* ------------------------------------------------------------------ */

describe('handleMonitorCheck', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens a new incident when monitor is down and none is open', async () => {
    vi.mocked(repo.findOpenIncident).mockResolvedValue(null)
    vi.mocked(repo.createIncident).mockResolvedValue(mockOpenIncident)

    const result = await handleMonitorCheck(mockDb, {
      ...baseCheck,
      ok: false,
      statusCode: 503,
    })

    expect(result.action).toBe('opened')
    expect(repo.createIncident).toHaveBeenCalledOnce()
    expect(repo.resolveIncident).not.toHaveBeenCalled()
  })

  it('is a noop when monitor is down and an incident is already open', async () => {
    vi.mocked(repo.findOpenIncident).mockResolvedValue(mockOpenIncident)

    const result = await handleMonitorCheck(mockDb, {
      ...baseCheck,
      ok: false,
      statusCode: 503,
    })

    expect(result.action).toBe('noop')
    expect(repo.createIncident).not.toHaveBeenCalled()
  })

  it('resolves an open incident when monitor comes back up', async () => {
    const resolvedAt = new Date('2025-01-15T10:00:00Z')
    vi.mocked(repo.findOpenIncident).mockResolvedValue(mockOpenIncident)
    vi.mocked(repo.resolveIncident).mockResolvedValue({
      ...mockOpenIncident,
      resolvedAt,
      durationMs: 3_600_000,
    } as repo.ResolvedIncident)

    const result = await handleMonitorCheck(mockDb, {
      ...baseCheck,
      ok: true,
      statusCode: 200,
      checkedAt: resolvedAt,
    })

    expect(result.action).toBe('resolved')
    expect(repo.resolveIncident).toHaveBeenCalledWith(
      mockDb,
      mockOpenIncident.id,
      resolvedAt,
    )
  })

  it('is a noop when monitor is up and no open incident exists', async () => {
    vi.mocked(repo.findOpenIncident).mockResolvedValue(null)

    const result = await handleMonitorCheck(mockDb, {
      ...baseCheck,
      ok: true,
      statusCode: 200,
    })

    expect(result.action).toBe('noop')
    expect(repo.createIncident).not.toHaveBeenCalled()
    expect(repo.resolveIncident).not.toHaveBeenCalled()
  })
})