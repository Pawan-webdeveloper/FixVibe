/**
 * Tests for incident updates (Phase 6.2).
 *
 * Covers:
 *   - Pure validators (PostIncidentUpdateSchema, INCIDENT_UPDATE_STATUSES)
 *   - Pure helpers (parseStatus, incidentUpdateStatusLabel)
 *   - listIncidentUpdatesPublicForIncidents batched read (mocked DB)
 *   - postIncidentUpdate auth + write path (mocked DB)
 *   - listIncidentUpdatesInternal returns the row + creator email (mocked DB)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INCIDENT_UPDATE_MESSAGE_MAX,
  INCIDENT_UPDATE_MESSAGE_MIN,
  INCIDENT_UPDATE_STATUSES,
  IncidentUpdateMessageSchema,
  IncidentUpdateStatusSchema,
  PostIncidentUpdateSchema,
  incidentUpdateStatusLabel,
  listIncidentUpdatesInternal,
  listIncidentUpdatesPublicForIncidents,
  parseStatus,
  postIncidentUpdate,
} from '../src/queries/incident-updates.ts'

/* -------------------------------------------------------------------------- */
/* Pure validators                                                             */
/* -------------------------------------------------------------------------- */

describe('INCIDENT_UPDATE_STATUSES', () => {
  it('exposes the four canonical stages in lifecycle order', () => {
    expect(INCIDENT_UPDATE_STATUSES).toEqual([
      'investigating',
      'identified',
      'monitoring',
      'resolved',
    ])
  })

  it('is readonly at the type level (frozen tuple)', () => {
    expect(Array.isArray(INCIDENT_UPDATE_STATUSES)).toBe(true)
    // as const → tuple; push would be a TS error, but runtime arrays
    // are still mutable. The export contract is the typing, not the
    // runtime shape.
  })
})

describe('IncidentUpdateStatusSchema', () => {
  it('accepts each canonical stage', () => {
    for (const s of INCIDENT_UPDATE_STATUSES) {
      expect(IncidentUpdateStatusSchema.safeParse(s).success).toBe(true)
    }
  })

  it('rejects anything outside the four-stage vocabulary', () => {
    expect(IncidentUpdateStatusSchema.safeParse('postmortem').success).toBe(false)
    expect(IncidentUpdateStatusSchema.safeParse('Investigating').success).toBe(false) // case
    expect(IncidentUpdateStatusSchema.safeParse('').success).toBe(false)
    expect(IncidentUpdateStatusSchema.safeParse(null).success).toBe(false)
    expect(IncidentUpdateStatusSchema.safeParse(42).success).toBe(false)
  })
})

describe('IncidentUpdateMessageSchema', () => {
  it('accepts a normal-length message', () => {
    const r = IncidentUpdateMessageSchema.safeParse('We are investigating elevated 5xx responses.')
    expect(r.success).toBe(true)
  })

  it('trims whitespace before length check (so "  " is rejected as empty)', () => {
    expect(IncidentUpdateMessageSchema.safeParse('   ').success).toBe(false)
    expect(IncidentUpdateMessageSchema.safeParse('\n\t').success).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(IncidentUpdateMessageSchema.safeParse('').success).toBe(false)
  })

  it('rejects messages over the max', () => {
    const tooLong = 'x'.repeat(INCIDENT_UPDATE_MESSAGE_MAX + 1)
    expect(IncidentUpdateMessageSchema.safeParse(tooLong).success).toBe(false)
  })

  it('accepts a message at the max length', () => {
    const exactly = 'x'.repeat(INCIDENT_UPDATE_MESSAGE_MAX)
    expect(IncidentUpdateMessageSchema.safeParse(exactly).success).toBe(true)
  })

  it('rejects non-strings', () => {
    expect(IncidentUpdateMessageSchema.safeParse(null).success).toBe(false)
    expect(IncidentUpdateMessageSchema.safeParse(123).success).toBe(false)
  })

  it('exposes the min as 1', () => {
    expect(INCIDENT_UPDATE_MESSAGE_MIN).toBe(1)
  })

  it('exposes the max as 4000', () => {
    expect(INCIDENT_UPDATE_MESSAGE_MAX).toBe(4000)
  })
})

describe('PostIncidentUpdateSchema', () => {
  it('accepts a valid body', () => {
    const r = PostIncidentUpdateSchema.safeParse({
      status: 'identified',
      message: 'The root cause is a misconfigured edge function.',
    })
    expect(r.success).toBe(true)
  })

  it('rejects when status is missing', () => {
    const r = PostIncidentUpdateSchema.safeParse({ message: 'no status here' })
    expect(r.success).toBe(false)
  })

  it('rejects when message is missing', () => {
    const r = PostIncidentUpdateSchema.safeParse({ status: 'investigating' })
    expect(r.success).toBe(false)
  })

  it('rejects unknown extra keys (strict body shape)', () => {
    // zod by default strips unknown keys, not errors. We do not enforce
    // strict() here — the API route picks { status, message } and ignores
    // the rest, so a noisy client doesn't break.
    const r = PostIncidentUpdateSchema.safeParse({
      status: 'investigating',
      message: 'ok',
      spam: 'ignore me',
    })
    expect(r.success).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

describe('parseStatus', () => {
  it('returns the typed union for each canonical stage', () => {
    expect(parseStatus('investigating')).toBe('investigating')
    expect(parseStatus('identified')).toBe('identified')
    expect(parseStatus('monitoring')).toBe('monitoring')
    expect(parseStatus('resolved')).toBe('resolved')
  })

  it('falls back to "investigating" for unknown values', () => {
    expect(parseStatus('postmortem')).toBe('investigating')
    expect(parseStatus('Investigating')).toBe('investigating') // wrong case
    expect(parseStatus('')).toBe('investigating')
  })
})

describe('incidentUpdateStatusLabel', () => {
  it('humanises each stage', () => {
    expect(incidentUpdateStatusLabel('investigating')).toBe('Investigating')
    expect(incidentUpdateStatusLabel('identified')).toBe('Identified')
    expect(incidentUpdateStatusLabel('monitoring')).toBe('Monitoring')
    expect(incidentUpdateStatusLabel('resolved')).toBe('Resolved')
  })
})

/* -------------------------------------------------------------------------- */
/* listIncidentUpdatesPublicForIncidents (mocked DB)                           */
/* -------------------------------------------------------------------------- */

describe('listIncidentUpdatesPublicForIncidents', () => {
  let mockSelect: ReturnType<typeof vi.fn>
  let mockFrom: ReturnType<typeof vi.fn>
  let mockWhere: ReturnType<typeof vi.fn>
  let mockOrderBy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    vi.doUnmock('../src/client.ts')
    mockOrderBy = vi.fn()
    mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }))
    mockFrom = vi.fn(() => ({ where: mockWhere }))
    mockSelect = vi.fn(() => ({ from: mockFrom }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../src/client.ts')
  })

  it('returns an empty Map when given no incident ids (no DB call)', async () => {
    vi.doMock('../src/client.ts', () => ({
      db: { select: mockSelect },
    }))
    const { listIncidentUpdatesPublicForIncidents: fn } = await import(
      '../src/queries/incident-updates.ts'
    )
    const result = await fn([])
    expect(result.size).toBe(0)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('returns only the public-safe fields (no creator uuid / email)', async () => {
    mockOrderBy.mockResolvedValueOnce([
      {
        incidentId: 'inc-1',
        status: 'investigating',
        message: 'Looking into it',
        createdAt: new Date('2025-01-01T00:00:00Z'),
      },
    ])

    vi.doMock('../src/client.ts', () => ({
      db: { select: mockSelect },
    }))

    const { listIncidentUpdatesPublicForIncidents: fn } = await import(
      '../src/queries/incident-updates.ts'
    )
    const result = await fn(['inc-1'])
    expect(result.get('inc-1')).toEqual([
      {
        status: 'investigating',
        message: 'Looking into it',
        createdAt: new Date('2025-01-01T00:00:00Z'),
      },
    ])
    // Ensure the row has no creator fields
    const entry = result.get('inc-1')?.[0] as Record<string, unknown>
    expect(entry).not.toHaveProperty('createdBy')
    expect(entry).not.toHaveProperty('creatorEmail')
  })

  it('groups multiple updates per incident in arrival order', async () => {
    mockOrderBy.mockResolvedValueOnce([
      {
        incidentId: 'inc-1',
        status: 'investigating',
        message: 'first',
        createdAt: new Date('2025-01-01T00:00:00Z'),
      },
      {
        incidentId: 'inc-1',
        status: 'identified',
        message: 'second',
        createdAt: new Date('2025-01-01T01:00:00Z'),
      },
      {
        incidentId: 'inc-2',
        status: 'monitoring',
        message: 'other incident',
        createdAt: new Date('2025-01-01T02:00:00Z'),
      },
    ])

    vi.doMock('../src/client.ts', () => ({
      db: { select: mockSelect },
    }))

    const { listIncidentUpdatesPublicForIncidents: fn } = await import(
      '../src/queries/incident-updates.ts'
    )
    const result = await fn(['inc-1', 'inc-2'])

    expect(result.get('inc-1')).toHaveLength(2)
    expect(result.get('inc-2')).toHaveLength(1)
    expect(result.get('inc-1')?.[0]?.message).toBe('first')
    expect(result.get('inc-1')?.[1]?.message).toBe('second')
  })

  it('coerces unknown status values to "investigating"', async () => {
    mockOrderBy.mockResolvedValueOnce([
      {
        incidentId: 'inc-1',
        status: 'postmortem', // not in the vocabulary
        message: 'a stale row from before a vocabulary change',
        createdAt: new Date(),
      },
    ])

    vi.doMock('../src/client.ts', () => ({
      db: { select: mockSelect },
    }))

    const { listIncidentUpdatesPublicForIncidents: fn } = await import(
      '../src/queries/incident-updates.ts'
    )
    const result = await fn(['inc-1'])
    expect(result.get('inc-1')?.[0]?.status).toBe('investigating')
  })
})

/* -------------------------------------------------------------------------- */
/* postIncidentUpdate (mocked DB)                                              */
/* -------------------------------------------------------------------------- */

describe('postIncidentUpdate', () => {
  let mockSelect: ReturnType<typeof vi.fn>
  let mockInsert: ReturnType<typeof vi.fn>
  let mockFrom: ReturnType<typeof vi.fn>
  let mockInnerJoin: ReturnType<typeof vi.fn>
  let mockLeftJoin: ReturnType<typeof vi.fn>
  let mockWhere: ReturnType<typeof vi.fn>
  let mockLimit: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks() // clears queued mockReturnValueOnce / mockResolvedValueOnce
    vi.doUnmock('../src/client.ts')
    vi.doUnmock('../src/queries/projects.ts')
    mockLimit = vi.fn()
    mockWhere = vi.fn(() => ({ limit: mockLimit }))
    mockInnerJoin = vi.fn(() => ({ where: mockWhere }))
    mockLeftJoin = vi.fn(() => ({ where: mockWhere }))
    mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin, leftJoin: mockLeftJoin }))
    mockSelect = vi.fn(() => ({ from: mockFrom }))
    mockInsert = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../src/client.ts')
    vi.doUnmock('../src/queries/projects.ts')
  })

  const userViewer = { kind: 'user' as const, userId: 'user-1' }
  const anonymousViewer = { kind: 'anonymous' as const }

  it('refuses anonymous viewers (returns null without touching DB)', async () => {
    vi.doMock('../src/client.ts', () => ({
      db: { select: mockSelect, insert: mockInsert },
    }))

    const { postIncidentUpdate: fn } = await import('../src/queries/incident-updates.ts')
    const result = await fn('inc-1', anonymousViewer, {
      status: 'investigating',
      message: 'hello',
    })
    expect(result).toBeNull()
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns null when the incident does not exist', async () => {
    mockLimit.mockResolvedValueOnce([]) // empty → no incident → return null
    vi.doMock('../src/client.ts', () => ({
      db: { select: mockSelect, insert: mockInsert },
    }))

    const { postIncidentUpdate: fn } = await import('../src/queries/incident-updates.ts')
    const result = await fn('missing', userViewer, {
      status: 'investigating',
      message: 'hello',
    })
    expect(result).toBeNull()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('inserts the update and returns the row + creator email', async () => {
    // Two select calls in postIncidentUpdate:
    //   1) projectIdForIncident → select → from(incidents) → innerJoin → where → limit
    //   2) re-read for creatorEmail → select → from(incidentUpdates) → leftJoin(users) → where → limit
    //
    // Both calls share the same chain mocks. The default chain covers (1);
    // for (2) we override `from()` on the second call so the chain ends in
    // leftJoin, and the rest of the chain (where → limit) is the same mocks.

    // (1) projectId lookup
    mockLimit.mockResolvedValueOnce([{ projectId: 'proj-1' }])

    // (2) getProject ownership check
    vi.doMock('../src/queries/projects.ts', () => ({
      getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
    }))

    // (3) insert
    const inserted = {
      id: 'upd-1',
      incidentId: 'inc-1',
      status: 'identified',
      message: 'Root cause: db connection pool exhausted.',
      createdBy: 'user-1',
      createdAt: new Date('2025-01-01T00:00:00Z'),
    }
    const returning = vi.fn(() => Promise.resolve([inserted]))
    const values = vi.fn(() => ({ returning }))
    mockInsert.mockReturnValueOnce({ values })

    // (4) re-read for creatorEmail
    const withEmail = {
      id: 'upd-1',
      incidentId: 'inc-1',
      status: 'identified',
      message: 'Root cause: db connection pool exhausted.',
      createdBy: 'user-1',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      creatorEmail: 'oncall@example.com',
    }
    mockLimit.mockResolvedValueOnce([withEmail])
    // Override the SECOND select's `from()` — keep innerJoin too so the
    // call chain still works if anything unexpected touches it.
    const finalFrom = vi.fn(() => ({
      innerJoin: mockInnerJoin,
      leftJoin: mockLeftJoin,
    }))
    mockSelect.mockReturnValueOnce({ from: finalFrom })

    vi.doMock('../src/client.ts', () => ({
      db: {
        select: mockSelect,
        insert: mockInsert,
        query: {
          // projectIdForIncident does a follow-up findFirst on projects;
          // returning a row here keeps the chain moving.
          projects: { findFirst: vi.fn().mockResolvedValue({ id: 'proj-1' }) },
        },
      },
    }))

    const { postIncidentUpdate: fn } = await import('../src/queries/incident-updates.ts')
    const result = await fn('inc-1', userViewer, {
      status: 'identified',
      message: 'Root cause: db connection pool exhausted.',
    })

    expect(result).toEqual(withEmail)
    expect(values).toHaveBeenCalledWith({
      incidentId: 'inc-1',
      status: 'identified',
      message: 'Root cause: db connection pool exhausted.',
      createdBy: 'user-1',
    })
  })
})

/* -------------------------------------------------------------------------- */
/* listIncidentUpdatesInternal (mocked DB)                                     */
/* -------------------------------------------------------------------------- */

describe('listIncidentUpdatesInternal', () => {
  let mockSelect: ReturnType<typeof vi.fn>
  let mockFrom: ReturnType<typeof vi.fn>
  let mockInnerJoin: ReturnType<typeof vi.fn>
  let mockLeftJoin: ReturnType<typeof vi.fn>
  let mockWhere: ReturnType<typeof vi.fn>
  let mockOrderBy: ReturnType<typeof vi.fn>
  let mockLimit: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    vi.doUnmock('../src/client.ts')
    vi.doUnmock('../src/queries/projects.ts')
    mockOrderBy = vi.fn()
    mockLimit = vi.fn()
    mockWhere = vi.fn(() => ({ orderBy: mockOrderBy, limit: mockLimit }))
    mockLeftJoin = vi.fn(() => ({ where: mockWhere }))
    mockInnerJoin = vi.fn(() => ({ where: mockWhere }))
    mockFrom = vi.fn(() => ({ leftJoin: mockLeftJoin, innerJoin: mockInnerJoin }))
    mockSelect = vi.fn(() => ({ from: mockFrom }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../src/client.ts')
    vi.doUnmock('../src/queries/projects.ts')
  })

  it('returns empty array when the viewer does not own the incident', async () => {
    // 1) incidents → projectId lookup (innerJoin monitors) → 1 row
    mockLimit.mockResolvedValueOnce([{ projectId: 'proj-1' }])
    // 2) getProject ownership check → NOT owner
    vi.doMock('../src/queries/projects.ts', () => ({
      getProject: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('../src/client.ts', () => ({
      db: { select: mockSelect, query: { projects: { findFirst: vi.fn() } } },
    }))

    const { listIncidentUpdatesInternal: fn } = await import('../src/queries/incident-updates.ts')
    const result = await fn('inc-1', { kind: 'user', userId: 'u1' })
    expect(result).toEqual([])
  })

  it('returns updates with creatorEmail attached', async () => {
    mockLimit.mockResolvedValueOnce([{ projectId: 'proj-1' }])
    vi.doMock('../src/queries/projects.ts', () => ({
      getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
    }))
    vi.doMock('../src/client.ts', () => ({
      db: {
        select: mockSelect,
        query: {
          projects: { findFirst: vi.fn().mockResolvedValue({ id: 'proj-1' }) },
        },
      },
    }))

    mockOrderBy.mockResolvedValueOnce([
      {
        id: 'upd-1',
        incidentId: 'inc-1',
        status: 'investigating',
        message: 'first',
        createdBy: 'user-1',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        creatorEmail: 'oncall@example.com',
      },
      {
        id: 'upd-2',
        incidentId: 'inc-1',
        status: 'identified',
        message: 'second',
        createdBy: 'user-1',
        createdAt: new Date('2025-01-01T01:00:00Z'),
        creatorEmail: 'oncall@example.com',
      },
    ])

    const { listIncidentUpdatesInternal: fn } = await import('../src/queries/incident-updates.ts')
    const result = await fn('inc-1', { kind: 'user', userId: 'user-1' })

    expect(result).toHaveLength(2)
    expect(result[0]?.creatorEmail).toBe('oncall@example.com')
    expect(result[1]?.status).toBe('identified')
  })
})
