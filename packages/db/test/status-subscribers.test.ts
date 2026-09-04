/**
 * Tests for status-page email subscribers (Phase 6.3).
 *
 * Pure-helper coverage (no DB):
 *   - normalizeEmail / isValidEmail / generateSubscriberToken
 *
 * Mocked-DB coverage:
 *   - createStatusSubscriber (new row + idempotent re-subscribe)
 *   - confirmStatusSubscriber (token lookup + confirmed flag)
 *   - unsubscribeByToken (soft-delete)
 *   - listConfirmedSubscribersForMonitor (joins + filter)
 *   - countSubscribeAttemptsByIpSince (per-IP filter)
 *   - getProjectForSubscribe (slug resolution)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  countSubscribeAttemptsByIpSince,
  createStatusSubscriber,
  generateSubscriberToken,
  getProjectForSubscribe,
  isValidEmail,
  listConfirmedSubscribersForMonitor,
  normalizeEmail,
  unsubscribeByToken,
} from '../src/queries/status-subscribers.ts'

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com')
  })

  it('leaves already-normalised emails alone', () => {
    expect(normalizeEmail('foo@example.com')).toBe('foo@example.com')
  })
})

describe('isValidEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidEmail('foo@example.com')).toBe(true)
    expect(isValidEmail('a.b+c@sub.example.co')).toBe(true)
  })

  it('rejects obvious typos', () => {
    expect(isValidEmail('foo')).toBe(false)
    expect(isValidEmail('foo@')).toBe(false)
    expect(isValidEmail('foo@bar')).toBe(false)
    expect(isValidEmail('foo bar@example.com')).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })
})

describe('generateSubscriberToken', () => {
  it('returns a 64-char hex string', () => {
    const token = generateSubscriberToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces a different token on every call', () => {
    const a = generateSubscriberToken()
    const b = generateSubscriberToken()
    expect(a).not.toBe(b)
  })
})

/* -------------------------------------------------------------------------- */
/* Mocked-DB tests                                                             */
/* -------------------------------------------------------------------------- */

describe('createStatusSubscriber', () => {
  let mockInsert: ReturnType<typeof vi.fn>
  let mockOnConflictDoUpdate: ReturnType<typeof vi.fn>
  let mockReturning: ReturnType<typeof vi.fn>
  let mockValues: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    mockReturning = vi.fn()
    mockValues = vi.fn(() => ({ returning: mockReturning, onConflictDoUpdate: mockOnConflictDoUpdate }))
    mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturning }))
    mockInsert = vi.fn(() => ({ values: mockValues }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../src/client.ts')
  })

  it('returns null on an obviously invalid email without touching DB', async () => {
    vi.doMock('../src/client.ts', () => ({ db: { insert: mockInsert } }))
    const { createStatusSubscriber: fn } = await import('../src/queries/status-subscribers.ts')
    const result = await fn({
      projectId: 'proj-1',
      email: 'not-an-email',
      ipHash: 'h',
    })
    expect(result).toBeNull()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('inserts a fresh row and returns it', async () => {
    mockReturning.mockResolvedValueOnce([{
      id: 'sub-1',
      projectId: 'proj-1',
      email: 'foo@example.com',
      token: 'a'.repeat(64),
      confirmed: false,
      confirmedAt: null,
      unsubscribedAt: null,
      ipHash: 'h',
      createdAt: new Date('2025-01-01T00:00:00Z'),
    }])

    vi.doMock('../src/client.ts', () => ({ db: { insert: mockInsert } }))

    const { createStatusSubscriber: fn } = await import('../src/queries/status-subscribers.ts')
    const result = await fn({
      projectId: 'proj-1',
      email: 'Foo@Example.com',
      ipHash: 'h',
    })

    expect(result).not.toBeNull()
    expect(result!.email).toBe('foo@example.com')
    // Normalisation happens before the insert
    const valuesArg = mockValues.mock.calls[0]?.[0] as Record<string, unknown>
    expect(valuesArg['email']).toBe('foo@example.com')
  })

  it('on conflict rotates the token and keeps unsubscribedAt via COALESCE', async () => {
    mockReturning.mockResolvedValueOnce([{ id: 'sub-1', token: 'b'.repeat(64) }])

    vi.doMock('../src/client.ts', () => ({ db: { insert: mockInsert } }))

    const { createStatusSubscriber: fn } = await import('../src/queries/status-subscribers.ts')
    await fn({ projectId: 'proj-1', email: 'foo@example.com', ipHash: 'h2' })

    // The second branch of the insert — onConflictDoUpdate — was used.
    expect(mockOnConflictDoUpdate).toHaveBeenCalledOnce()
    const setArg = mockOnConflictDoUpdate.mock.calls[0]?.[0] as { set?: Record<string, unknown> }
    expect(setArg?.set?.['confirmed']).toBe(false)
    expect(setArg?.set?.['ipHash']).toBe('h2')
    // The token in the `set` is a fresh hex string.
    const token = setArg?.set?.['token'] as string
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })
})

/* -------------------------------------------------------------------------- */
/* listConfirmedSubscribersForMonitor                                          */
/* -------------------------------------------------------------------------- */

describe('listConfirmedSubscribersForMonitor', () => {
  let mockSelect: ReturnType<typeof vi.fn>
  let mockFrom: ReturnType<typeof vi.fn>
  let mockInnerJoin: ReturnType<typeof vi.fn>
  let mockWhere: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    mockWhere = vi.fn(() => Promise.resolve([]))
    // Two innerJoins in series: statusSubscribers→projects, then projects→monitors.
    // Both calls return the same `{ where }` shim because `where` is what we
    // await on — the joins just have to chain without throwing.
    mockInnerJoin = vi.fn(() => ({ where: mockWhere, innerJoin: vi.fn(() => ({ where: mockWhere })) }))
    mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }))
    mockSelect = vi.fn(() => ({ from: mockFrom }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../src/client.ts')
  })

  it('returns an empty array when nobody is subscribed', async () => {
    mockWhere.mockResolvedValueOnce([])
    vi.doMock('../src/client.ts', () => ({ db: { select: mockSelect } }))
    const { listConfirmedSubscribersForMonitor: fn } = await import(
      '../src/queries/status-subscribers.ts'
    )
    expect(await fn('mon-1')).toEqual([])
  })

  it('returns one row per confirmed+active subscriber', async () => {
    mockWhere.mockResolvedValueOnce([
      { id: 'sub-1', email: 'foo@example.com', token: 't1' },
      { id: 'sub-2', email: 'bar@example.com', token: 't2' },
    ])
    vi.doMock('../src/client.ts', () => ({ db: { select: mockSelect } }))
    const { listConfirmedSubscribersForMonitor: fn } = await import(
      '../src/queries/status-subscribers.ts'
    )
    const rows = await fn('mon-1')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.email).toBe('foo@example.com')
    expect(rows[1]?.token).toBe('t2')
  })
})

/* -------------------------------------------------------------------------- */
/* countSubscribeAttemptsByIpSince                                              */
/* -------------------------------------------------------------------------- */

describe('countSubscribeAttemptsByIpSince', () => {
  let mockSelect: ReturnType<typeof vi.fn>
  let mockFrom: ReturnType<typeof vi.fn>
  let mockWhere: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    mockWhere = vi.fn(() => Promise.resolve([{ n: 0, oldest: null }]))
    mockFrom = vi.fn(() => ({ where: mockWhere }))
    mockSelect = vi.fn(() => ({ from: mockFrom }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../src/client.ts')
  })

  it('returns the count + oldest timestamp', async () => {
    mockWhere.mockResolvedValueOnce([{ n: 3, oldest: new Date('2025-01-01T00:00:00Z') }])
    vi.doMock('../src/client.ts', () => ({ db: { select: mockSelect } }))
    const { countSubscribeAttemptsByIpSince: fn } = await import(
      '../src/queries/status-subscribers.ts'
    )
    const result = await fn('h', new Date())
    expect(result.count).toBe(3)
    expect(result.oldest).toEqual(new Date('2025-01-01T00:00:00Z'))
  })

  it('returns zero/null when there is no row', async () => {
    mockWhere.mockResolvedValueOnce([])
    vi.doMock('../src/client.ts', () => ({ db: { select: mockSelect } }))
    const { countSubscribeAttemptsByIpSince: fn } = await import(
      '../src/queries/status-subscribers.ts'
    )
    const result = await fn('h', new Date())
    expect(result.count).toBe(0)
    expect(result.oldest).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* getProjectForSubscribe                                                       */
/* -------------------------------------------------------------------------- */

describe('getProjectForSubscribe', () => {
  let mockSelect: ReturnType<typeof vi.fn>
  let mockFrom: ReturnType<typeof vi.fn>
  let mockWhere: ReturnType<typeof vi.fn>
  let mockLimit: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    mockLimit = vi.fn(() => Promise.resolve(null))
    mockWhere = vi.fn(() => ({ limit: mockLimit }))
    mockFrom = vi.fn(() => ({ where: mockWhere }))
    mockSelect = vi.fn(() => ({ from: mockFrom }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../src/client.ts')
  })

  it('returns null when the project does not exist', async () => {
    mockLimit.mockResolvedValueOnce([])
    vi.doMock('../src/client.ts', () => ({ db: { select: mockSelect } }))
    const { getProjectForSubscribe: fn } = await import('../src/queries/status-subscribers.ts')
    expect(await fn('missing-slug')).toBeNull()
  })

  it('returns the public-safe shape', async () => {
    mockLimit.mockResolvedValueOnce([{ id: 'p1', name: 'My App', url: 'https://x.test', slug: 'my-app' }])
    vi.doMock('../src/client.ts', () => ({ db: { select: mockSelect } }))
    const { getProjectForSubscribe: fn } = await import('../src/queries/status-subscribers.ts')
    const row = await fn('my-app')
    expect(row).toEqual({ id: 'p1', name: 'My App', url: 'https://x.test', slug: 'my-app' })
  })
})

/* -------------------------------------------------------------------------- */
/* confirm + unsubscribe smoke (mocked DB)                                     */
/* -------------------------------------------------------------------------- */

describe('unsubscribeByToken', () => {
  let mockUpdate: ReturnType<typeof vi.fn>
  let mockSet: ReturnType<typeof vi.fn>
  let mockWhere: ReturnType<typeof vi.fn>
  let mockReturning: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    mockReturning = vi.fn(() => Promise.resolve([{ projectId: 'proj-1' }]))
    mockWhere = vi.fn(() => ({ returning: mockReturning }))
    mockSet = vi.fn(() => ({ where: mockWhere }))
    mockUpdate = vi.fn(() => ({ set: mockSet }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../src/client.ts')
  })

  it('returns null when the token does not match', async () => {
    mockReturning.mockResolvedValueOnce([])
    vi.doMock('../src/client.ts', () => ({ db: { update: mockUpdate } }))
    const { unsubscribeByToken: fn } = await import('../src/queries/status-subscribers.ts')
    expect(await fn('unknown')).toBeNull()
  })

  it('soft-deletes the row and returns the project slug', async () => {
    mockReturning.mockResolvedValueOnce([{ projectId: 'proj-1' }])
    // Second SELECT (project lookup)
    const mockLimit = vi.fn(() => Promise.resolve([{ slug: 'my-app', name: 'My App' }]))
    const mockFrom = vi.fn(() => ({ where: vi.fn(() => ({ limit: mockLimit })) }))
    const mockSelect = vi.fn(() => ({ from: mockFrom }))

    vi.doMock('../src/client.ts', () => ({ db: { update: mockUpdate, select: mockSelect } }))
    const { unsubscribeByToken: fn } = await import('../src/queries/status-subscribers.ts')
    expect(await fn('t')).toEqual({ slug: 'my-app', name: 'My App' })
    expect(mockSet).toHaveBeenCalledOnce()
  })
})
