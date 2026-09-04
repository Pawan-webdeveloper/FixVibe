/**
 * Tests for the subscribe rate limiter.
 *
 * Pure (the SQL count is mocked) — verifies the verdict shape and the
 * retry-after math. The actual SELECT is exercised in the db-layer tests.
 */

import { describe, expect, it, vi } from 'vitest'

const countSubscribeAttemptsByIpSince = vi.fn()
const now = Date.now()

vi.mock('@scanlyfix/db', () => ({ countSubscribeAttemptsByIpSince }))

const { checkSubscribeAllowed } = await import('../lib/ratelimit-status-subscribe.ts')

describe('checkSubscribeAllowed', () => {
  it('returns ok when count is below the limit', async () => {
    countSubscribeAttemptsByIpSince.mockResolvedValueOnce({ count: 2, oldest: null })
    const verdict = await checkSubscribeAllowed('h')
    expect(verdict).toEqual({ ok: true })
  })

  it('refuses when count is at the limit (5)', async () => {
    countSubscribeAttemptsByIpSince.mockResolvedValueOnce({
      count: 5,
      oldest: new Date(now - 30 * 60 * 1000),
    })
    const verdict = await checkSubscribeAllowed('h')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.retryAfterSeconds).toBeGreaterThan(0)
      expect(verdict.reason).toContain('5')
      expect(verdict.reason).toContain('hour')
    }
  })

  it('refuses when count is well over the limit', async () => {
    countSubscribeAttemptsByIpSince.mockResolvedValueOnce({
      count: 50,
      oldest: new Date(now - 60 * 60 * 1000),
    })
    const verdict = await checkSubscribeAllowed('h')
    expect(verdict.ok).toBe(false)
  })

  it('retry-after is bounded below by 1 second', async () => {
    countSubscribeAttemptsByIpSince.mockResolvedValueOnce({
      count: 99,
      oldest: new Date(now - 59 * 60 * 1000),
    })
    const verdict = await checkSubscribeAllowed('h')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.retryAfterSeconds).toBeGreaterThanOrEqual(1)
    }
  })
})
