/**
 * apps/web/test/alert-routing.test.ts
 *
 * Tests for the per-monitor channel routing logic.
 *
 * The contract that matters:
 *   1. Default (notifyChannels undefined / empty) → sendEmail=true + all enabled
 *   2. Non-empty list                              → sendEmail=false + only
 *                                                     the channels in the list
 *   3. Stale id in the list                        → silently skipped
 *   4. Schema validation rejects bad ids / too many entries
 */

import { describe, expect, it } from 'vitest'
import {
  AlertConfigSchema,
  resolveNotifyChannels,
  type ChannelRouting,
} from '../lib/alert-threshold.ts'

const ENABLED_IDS = ['ch-slack', 'ch-discord', 'ch-webhook'] as const

describe('resolveNotifyChannels', () => {
  it('returns sendEmail=true and all enabled channels when no config', () => {
    const r: ChannelRouting = resolveNotifyChannels(null, ENABLED_IDS)
    expect(r).toEqual({
      sendEmail: true,
      secondaryChannelIds: ['ch-slack', 'ch-discord', 'ch-webhook'],
    })
  })

  it('returns sendEmail=true and all enabled channels when config has no notifyChannels', () => {
    const r = resolveNotifyChannels(
      { followRedirects: false },
      ENABLED_IDS,
    )
    expect(r.sendEmail).toBe(true)
    expect(r.secondaryChannelIds).toEqual(ENABLED_IDS)
  })

  it('returns sendEmail=true and all enabled channels when notifyChannels is empty', () => {
    const r = resolveNotifyChannels({ notifyChannels: [] }, ENABLED_IDS)
    expect(r.sendEmail).toBe(true)
    expect(r.secondaryChannelIds).toEqual(ENABLED_IDS)
  })

  it('suppresses email and restricts fan-out when notifyChannels has entries', () => {
    const r = resolveNotifyChannels(
      { notifyChannels: ['ch-slack'] },
      ENABLED_IDS,
    )
    expect(r.sendEmail).toBe(false)
    expect(r.secondaryChannelIds).toEqual(['ch-slack'])
  })

  it('returns sendEmail=true and an empty allowlist when notifyChannels names a deleted channel', () => {
    const r = resolveNotifyChannels(
      { notifyChannels: ['ch-deleted'] },
      ENABLED_IDS,
    )
    expect(r.sendEmail).toBe(false)
    expect(r.secondaryChannelIds).toEqual([])
  })

  it('silently drops stale ids but keeps the valid ones', () => {
    const r = resolveNotifyChannels(
      { notifyChannels: ['ch-slack', 'ch-deleted', 'ch-discord'] },
      ENABLED_IDS,
    )
    expect(r.sendEmail).toBe(false)
    expect(r.secondaryChannelIds).toEqual(['ch-slack', 'ch-discord'])
  })

  it('handles a project with no channels configured', () => {
    const r = resolveNotifyChannels(null, [])
    expect(r).toEqual({ sendEmail: true, secondaryChannelIds: [] })
  })

  it('handles an empty allowlist with explicit routing', () => {
    const r = resolveNotifyChannels({ notifyChannels: ['x'] }, [])
    expect(r).toEqual({ sendEmail: false, secondaryChannelIds: [] })
  })

  it('preserves the order of the input allowlist (no sort)', () => {
    // The user's intent is order-preserving — the UI shows channels in
    // insertion order, and the routing should mirror that.
    const r = resolveNotifyChannels(
      { notifyChannels: ['ch-webhook', 'ch-slack', 'ch-discord'] },
      ENABLED_IDS,
    )
    expect(r.secondaryChannelIds).toEqual(['ch-webhook', 'ch-slack', 'ch-discord'])
  })
})

describe('AlertConfigSchema — notifyChannels', () => {
  it('accepts a list of valid UUIDs', () => {
    const r = AlertConfigSchema.safeParse({
      notifyChannels: [
        '550e8400-e29b-41d4-a716-446655440000',
        '660e8400-e29b-41d4-a716-446655440001',
      ],
    })
    expect(r.success).toBe(true)
  })

  it('rejects a non-UUID entry', () => {
    const r = AlertConfigSchema.safeParse({
      notifyChannels: ['not-a-uuid'],
    })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/UUID/i)
    }
  })

  it('rejects more than 5 entries', () => {
    const ids = Array.from(
      { length: 6 },
      (_, i) => `550e8400-e29b-41d4-a716-44665544000${i}`,
    )
    const r = AlertConfigSchema.safeParse({ notifyChannels: ids })
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/5 channels/i)
    }
  })

  it('accepts up to exactly 5 entries', () => {
    const ids = Array.from(
      { length: 5 },
      (_, i) => `550e8400-e29b-41d4-a716-44665544000${i}`,
    )
    const r = AlertConfigSchema.safeParse({ notifyChannels: ids })
    expect(r.success).toBe(true)
  })

  it('accepts an empty list (treated as default by resolver)', () => {
    const r = AlertConfigSchema.safeParse({ notifyChannels: [] })
    expect(r.success).toBe(true)
  })
})
