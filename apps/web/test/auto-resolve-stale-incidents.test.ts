/**
 * apps/web/test/auto-resolve-stale-incidents.test.ts
 *
 * Tests the daily stale-incident cron. The function is a thin Inngest
 * wrapper over two queries; the assertions cover the contract the
 * wrapper must honour:
 *   1. Find candidates, then resolve each, in steps.
 *   2. Race safety — when a row is no longer eligible by the time we
 *      try to resolve it, the update is a no-op (returns false).
 *   3. Empty backlog — return zero counts without throwing.
 *
 * The queries themselves are exercised in the live-DB test suite; this
 * file is the unit-level test of the wiring.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindStale = vi.fn()
const mockAutoResolve = vi.fn()

vi.mock('@scanlyfix/db', () => ({
  findStaleOpenIncidents: (...args: unknown[]) => mockFindStale(...args),
  autoResolveStaleIncident: (...args: unknown[]) => mockAutoResolve(...args),
}))

// The inngest mock returns the handler directly so we can call it like a
// plain async function. Without this, `inngest.createFunction` returns a
// complex InngestFunction type that is not directly callable from tests.
type CronHandler = (ctx: { step: { run: (n: string, fn: () => unknown) => Promise<unknown> } }) => Promise<unknown>
const handlers: CronHandler[] = []
vi.mock('@/lib/inngest.ts', () => ({
  inngest: {
    createFunction: (_config: unknown, handler: CronHandler) => {
      handlers.push(handler)
      return { __handler: handler }
    },
  },
}))

await import('../inngest/functions/auto-resolve-stale-incidents.ts')

beforeEach(() => {
  mockFindStale.mockReset()
  mockAutoResolve.mockReset()
  mockAutoResolve.mockResolvedValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Pull the handler Inngest would have called. */
function getHandler(): CronHandler {
  const h = handlers[handlers.length - 1]
  if (!h) throw new Error('No Inngest handler registered')
  return h
}

function makeStep() {
  return {
    run: vi.fn(async (_name: string, fn: () => unknown) => fn()),
    sendEvent: vi.fn(),
  }
}

describe('autoResolveStaleIncidents', () => {
  it('returns zero counts when no candidates exist', async () => {
    mockFindStale.mockResolvedValue([])

    const result = await getHandler()({ step: makeStep() } as never)

    expect(result).toEqual({ scanned: 0, resolved: 0, skipped: 0 })
    expect(mockAutoResolve).not.toHaveBeenCalled()
  })

  it('resolves every candidate in its own step', async () => {
    mockFindStale.mockResolvedValue([
      { id: 'inc-1', monitorId: 'mon-1', startedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
      { id: 'inc-2', monitorId: 'mon-2', startedAt: new Date(Date.now() - 26 * 60 * 60 * 1000) },
    ])

    const result = await getHandler()({ step: makeStep() } as never)

    expect(result).toEqual({ scanned: 2, resolved: 2, skipped: 0 })
    expect(mockAutoResolve).toHaveBeenCalledTimes(2)
    expect(mockAutoResolve).toHaveBeenNthCalledWith(1, 'inc-1')
    expect(mockAutoResolve).toHaveBeenNthCalledWith(2, 'inc-2')
  })

  it('counts a skipped update separately from a resolved one', async () => {
    mockFindStale.mockResolvedValue([
      { id: 'inc-1', monitorId: 'mon-1', startedAt: new Date() },
      { id: 'inc-2', monitorId: 'mon-2', startedAt: new Date() },
      { id: 'inc-3', monitorId: 'mon-3', startedAt: new Date() },
    ])
    // inc-2 lost the race — the real recovery closed it between find and
    // update.
    mockAutoResolve.mockImplementation(async (id: string) => id !== 'inc-2')

    const result = await getHandler()({ step: makeStep() } as never)

    expect(result).toEqual({ scanned: 3, resolved: 2, skipped: 1 })
  })

  it('passes the default limit to the find query', async () => {
    mockFindStale.mockResolvedValue([])
    await getHandler()({ step: makeStep() } as never)
    expect(mockFindStale).toHaveBeenCalledWith({ limit: 500 })
  })
})
