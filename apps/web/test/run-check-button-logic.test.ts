/**
 * apps/web/test/run-check-button-logic.test.ts
 *
 * Pure-helper tests for the RunCheckButton polling loop.
 *
 * `isLogRowNewer` is the decision: "is this row the one we just
 * triggered?" Tested directly with the four interesting inputs.
 *
 * `runLogPoll` is the orchestrator. It is more useful to test as
 * an integration than as a pure unit — it depends on a fetcher, a
 * clock, and a sleeper — but we can still drive it with stubs and
 * assert the right branch fires (onHit vs onDeadline) and the right
 * number of fetches happen.
 */

import { describe, expect, it, vi } from 'vitest'
import { isLogRowNewer, runLogPoll } from '@/components/monitors/run-check-button-logic.ts'

describe('isLogRowNewer', () => {
  it('returns true when no baseline is supplied', () => {
    expect(isLogRowNewer({ id: 'a', ts: '2026-01-01T00:00:00Z' }, null)).toBe(true)
  })

  it('returns false when the row id matches the baseline id', () => {
    expect(
      isLogRowNewer(
        { id: 'a', ts: '2026-01-01T00:00:00Z' },
        { firstId: 'a', firstTs: '2026-01-01T00:00:00Z' },
      ),
    ).toBe(false)
  })

  it('returns true when the row id differs from the baseline id', () => {
    expect(
      isLogRowNewer(
        { id: 'b', ts: '2026-01-01T00:00:00Z' },
        { firstId: 'a', firstTs: '2026-01-01T00:00:00Z' },
      ),
    ).toBe(true)
  })

  it('returns true when the row ts is later than the baseline ts even if the id somehow matches', () => {
    expect(
      isLogRowNewer(
        { id: 'a', ts: '2026-01-01T00:00:01Z' },
        { firstId: 'a', firstTs: '2026-01-01T00:00:00Z' },
      ),
    ).toBe(true)
  })

  it('treats a baseline with a null id as "ts-only"', () => {
    expect(
      isLogRowNewer(
        { id: 'a', ts: '2026-01-01T00:00:00Z' },
        { firstId: null, firstTs: '2025-12-31T00:00:00Z' },
      ),
    ).toBe(true)
  })
})

describe('runLogPoll', () => {
  it('calls onHit and stops polling when a new row appears', async () => {
    const onHit = vi.fn()
    const onDeadline = vi.fn()
    const fetcher = vi.fn().mockResolvedValue({ logs: [{ id: 'new', ts: '2026-01-01T00:00:05Z' }] })

    const handle = runLogPoll({
      monitorId: 'mon-1',
      baseline: { firstId: 'old', firstTs: '2026-01-01T00:00:00Z' },
      intervalMs: 1,
      timeoutMs: 5_000,
      fetcher,
      sleep: () => Promise.resolve(),
      now: () => 0,
      onHit,
      onDeadline,
    })

    const result = await handle.done

    expect(result.stop).toBe('hit')
    expect(onHit).toHaveBeenCalledTimes(1)
    expect(onDeadline).not.toHaveBeenCalled()
  })

  it('calls onDeadline when no new row ever appears', async () => {
    const onHit = vi.fn()
    const onDeadline = vi.fn()
    const fetcher = vi.fn().mockResolvedValue({ logs: [{ id: 'old', ts: '2026-01-01T00:00:00Z' }] })

    // The clock starts at 0, advances to past the deadline after
    // the first step has run. The startedAt baseline (0) plus the
    // 100ms timeout means the loop hits `now() - startedAt >=
    // timeoutMs` on the next step and fires onDeadline.
    let tick = 0
    const handle = runLogPoll({
      monitorId: 'mon-1',
      baseline: { firstId: 'old', firstTs: '2026-01-01T00:00:00Z' },
      intervalMs: 1,
      timeoutMs: 100,
      fetcher,
      sleep: () => Promise.resolve(),
      now: () => (tick++ > 0 ? 200 : 0),
      onHit,
      onDeadline,
    })

    const result = await handle.done

    expect(result.stop).toBe('deadline')
    expect(onHit).not.toHaveBeenCalled()
    expect(onDeadline).toHaveBeenCalledTimes(1)
  })

  it('cancel() resolves with stop=cancelled before the loop ticks again', async () => {
    const onHit = vi.fn()
    const onDeadline = vi.fn()
    const fetcher = vi.fn().mockResolvedValue({ logs: [{ id: 'new', ts: '2026-01-01T00:00:05Z' }] })

    const handle = runLogPoll({
      monitorId: 'mon-1',
      baseline: { firstId: 'old', firstTs: '2026-01-01T00:00:00Z' },
      intervalMs: 10,
      timeoutMs: 1_000,
      fetcher,
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      now: () => 0,
      onHit,
      onDeadline,
    })

    handle.cancel()
    const result = await handle.done

    expect(result.stop).toBe('cancelled')
    expect(onHit).not.toHaveBeenCalled()
    expect(onDeadline).not.toHaveBeenCalled()
  })

  it('survives a fetcher that throws', async () => {
    const onHit = vi.fn()
    const onDeadline = vi.fn()
    let attempts = 0
    const fetcher = vi.fn().mockImplementation(async () => {
      attempts++
      if (attempts === 1) throw new Error('network blip')
      return { logs: [{ id: 'new', ts: '2026-01-01T00:00:05Z' }] }
    })

    const handle = runLogPoll({
      monitorId: 'mon-1',
      baseline: { firstId: 'old', firstTs: '2026-01-01T00:00:00Z' },
      intervalMs: 1,
      timeoutMs: 5_000,
      fetcher,
      sleep: () => Promise.resolve(),
      now: () => 0,
      onHit,
      onDeadline,
    })

    const result = await handle.done

    expect(result.stop).toBe('hit')
    expect(onHit).toHaveBeenCalledTimes(1)
    expect(onDeadline).not.toHaveBeenCalled()
  })

  it('cancel() is idempotent', async () => {
    const onHit = vi.fn()
    const onDeadline = vi.fn()
    const fetcher = vi.fn().mockResolvedValue({ logs: [{ id: 'new', ts: '2026-01-01T00:00:05Z' }] })

    const handle = runLogPoll({
      monitorId: 'mon-1',
      baseline: { firstId: 'old', firstTs: '2026-01-01T00:00:00Z' },
      intervalMs: 10,
      timeoutMs: 100,
      fetcher,
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      now: () => 0,
      onHit,
      onDeadline,
    })

    handle.cancel()
    handle.cancel()
    handle.cancel()
    const result = await handle.done

    expect(result.stop).toBe('cancelled')
    expect(onHit).not.toHaveBeenCalled()
    expect(onDeadline).not.toHaveBeenCalled()
  })
})
