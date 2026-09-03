/**
 * cn utility function tests.
 *
 * Tests the class name merging utility used across components.
 */

import { describe, expect, it } from 'vitest'
import { cn } from '../lib/utils.ts'

describe('cn', () => {
  it('joins multiple class names', () => {
    const result = cn('foo', 'bar', 'baz')
    expect(result).toBe('foo bar baz')
  })

  it('filters out falsy values', () => {
    const result = cn('foo', false, null, undefined, 0, '', 'bar')
    expect(result).toBe('foo bar')
  })

  it('handles empty input', () => {
    const result = cn()
    expect(result).toBe('')
  })

  it('handles nested arrays', () => {
    const result = cn(['foo', 'bar'], 'baz')
    expect(result).toBe('foo bar baz')
  })

  it('handles numbers', () => {
    const result = cn('foo', 123, 'bar')
    expect(result).toBe('foo 123 bar')
  })

  it('handles deeply nested arrays', () => {
    const result = cn(['foo', ['bar', 'baz']])
    expect(result).toBe('foo bar baz')
  })

  it('handles conditional classes', () => {
    const isActive = true
    const isDisabled = false
    const result = cn(
      'base',
      isActive && 'active',
      isDisabled && 'disabled',
    )
    expect(result).toBe('base active')
  })
})
