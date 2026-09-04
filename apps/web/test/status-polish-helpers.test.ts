/**
 * Pure-helper tests for the status-page polish additions (Phase 6.4).
 *
 * The components themselves are server-rendered and tested via the
 * existing public-status integration tests in packages/db; this file
 * covers the pure helpers that drive them so their contracts are
 * pinned.
 */

import { describe, expect, it } from 'vitest'
import {
  formatLastUpdated,
  hasActiveMaintenance,
} from '../components/status/status-polish-helpers.ts'
import type { PublicMaintenanceWindow } from '@scanlyfix/db'

describe('formatLastUpdated', () => {
  it('formats seconds for very recent timestamps', () => {
    const now = Date.now()
    expect(formatLastUpdated(new Date(now - 5 * 1000))).toBe('5s ago')
  })

  it('formats minutes for older timestamps', () => {
    const now = Date.now()
    expect(formatLastUpdated(new Date(now - 5 * 60 * 1000))).toBe('5m ago')
  })

  it('formats hours for much older timestamps', () => {
    const now = Date.now()
    expect(formatLastUpdated(new Date(now - 3 * 60 * 60 * 1000))).toBe('3h ago')
  })
})

describe('hasActiveMaintenance', () => {
  const window: PublicMaintenanceWindow = {
    description: 'Sundays 02:00–04:00 UTC',
    reason: null,
  }

  it('returns false for an empty list', () => {
    expect(hasActiveMaintenance([])).toBe(false)
  })

  it('returns true when at least one window is active', () => {
    expect(hasActiveMaintenance([window])).toBe(true)
  })

  it('does not mutate the input array', () => {
    const input = [window]
    hasActiveMaintenance(input)
    expect(input).toHaveLength(1)
  })
})
