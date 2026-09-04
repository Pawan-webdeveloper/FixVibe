/**
 * Evaluate outcome tests for new probe features.
 *
 * Tests the evaluateOutcome function with:
 *   - expectedStatusCodes: exact match for 2xx
 *   - keywordCheck: response body contains/doesn't contain specific text
 *   - Body parameter for keyword checking
 */

import { describe, expect, it } from 'vitest'
import { evaluateOutcome } from '../lib/alert-threshold.ts'
import type { AlertConfig } from '../lib/alert-threshold.ts'

describe('evaluateOutcome - new features', () => {
  describe('expectedStatusCodes', () => {
    it('fails when status not in expectedStatusCodes', () => {
      const config: AlertConfig = {
        expectedStatusCodes: [200, 201, 204],
      }

      const result = evaluateOutcome({ statusCode: 301, latencyMs: 100 }, config)

      expect(result.ok).toBe(false)
      expect(result.reason).toContain('301')
      expect(result.reason).toContain('expected')
    })

    it('passes when status in expectedStatusCodes', () => {
      const config: AlertConfig = {
        expectedStatusCodes: [200, 201, 204],
      }

      const result = evaluateOutcome({ statusCode: 200, latencyMs: 100 }, config)

      expect(result.ok).toBe(true)
      expect(result.reason).toBeNull()
    })

    it('fails when status is 4xx and expectedStatusCodes is set', () => {
      const config: AlertConfig = {
        expectedStatusCodes: [200, 201],
      }

      const result = evaluateOutcome({ statusCode: 404, latencyMs: 100 }, config)

      expect(result.ok).toBe(false)
      expect(result.reason).toContain('404')
    })

    it('takes priority over failStatusCodes', () => {
      const config: AlertConfig = {
        expectedStatusCodes: [200],
        failStatusCodes: [500, 502],
      }

      // Status 500 is in failStatusCodes, but expectedStatusCodes takes priority
      const result = evaluateOutcome({ statusCode: 500, latencyMs: 100 }, config)

      expect(result.ok).toBe(false)
      expect(result.reason).toContain('500')
      expect(result.reason).toContain('expected')
    })
  })

  describe('keywordCheck', () => {
    it('fails when keyword not found (should_contain)', () => {
      const config: AlertConfig = {
        keywordCheck: {
          type: 'should_contain',
          value: 'Dashboard',
        },
      }

      const body = '<html><body>Welcome to our site</body></html>'
      const result = evaluateOutcome({ statusCode: 200, latencyMs: 100, body }, config)

      expect(result.ok).toBe(false)
      expect(result.reason).toContain('Dashboard')
      expect(result.reason).toContain('not found')
    })

    it('passes when keyword found (should_contain)', () => {
      const config: AlertConfig = {
        keywordCheck: {
          type: 'should_contain',
          value: 'Welcome',
        },
      }

      const body = '<html><body>Welcome to our site</body></html>'
      const result = evaluateOutcome({ statusCode: 200, latencyMs: 100, body }, config)

      expect(result.ok).toBe(true)
      expect(result.reason).toBeNull()
    })

    it('fails when keyword found (should_not_contain)', () => {
      const config: AlertConfig = {
        keywordCheck: {
          type: 'should_not_contain',
          value: 'Error',
        },
      }

      const body = '<html><body>Error: Something went wrong</body></html>'
      const result = evaluateOutcome({ statusCode: 200, latencyMs: 100, body }, config)

      expect(result.ok).toBe(false)
      expect(result.reason).toContain('Error')
      expect(result.reason).toContain('found')
    })

    it('passes when keyword not found (should_not_contain)', () => {
      const config: AlertConfig = {
        keywordCheck: {
          type: 'should_not_contain',
          value: 'Error',
        },
      }

      const body = '<html><body>Welcome to our site</body></html>'
      const result = evaluateOutcome({ statusCode: 200, latencyMs: 100, body }, config)

      expect(result.ok).toBe(true)
      expect(result.reason).toBeNull()
    })

    it('case-insensitive by default', () => {
      const config: AlertConfig = {
        keywordCheck: {
          type: 'should_contain',
          value: 'dashboard',
        },
      }

      const body = '<html><body>Welcome to Dashboard</body></html>'
      const result = evaluateOutcome({ statusCode: 200, latencyMs: 100, body }, config)

      expect(result.ok).toBe(true)
    })

    it('case-sensitive when specified', () => {
      const config: AlertConfig = {
        keywordCheck: {
          type: 'should_contain',
          value: 'dashboard',
          caseSensitive: true,
        },
      }

      const body = '<html><body>Welcome to Dashboard</body></html>'
      const result = evaluateOutcome({ statusCode: 200, latencyMs: 100, body }, config)

      expect(result.ok).toBe(false)
      expect(result.reason).toContain('dashboard')
    })

    it('searches in first 64KB of body', () => {
      const config: AlertConfig = {
        keywordCheck: {
          type: 'should_contain',
          value: 'needle',
        },
      }

      // Create a body larger than 64KB with keyword at the start
      const padding = 'x'.repeat(70000)
      const body = `needle${padding}`
      const result = evaluateOutcome({ statusCode: 200, latencyMs: 100, body }, config)

      expect(result.ok).toBe(true)
    })

    it('ignores body when not provided', () => {
      const config: AlertConfig = {
        keywordCheck: {
          type: 'should_contain',
          value: 'Dashboard',
        },
      }

      // No body provided
      const result = evaluateOutcome({ statusCode: 200, latencyMs: 100 }, config)

      expect(result.ok).toBe(true)
    })
  })

  describe('combined checks', () => {
    it('fails on multiple reasons', () => {
      const config: AlertConfig = {
        maxLatencyMs: 100,
        keywordCheck: {
          type: 'should_contain',
          value: 'Dashboard',
        },
      }

      const body = '<html><body>Welcome</body></html>'
      const result = evaluateOutcome({ statusCode: 200, latencyMs: 200, body }, config)

      expect(result.ok).toBe(false)
      expect(result.reason).toContain('ms >')
      expect(result.reason).toContain('Dashboard')
    })

    it('passes all checks', () => {
      const config: AlertConfig = {
        maxLatencyMs: 500,
        keywordCheck: {
          type: 'should_contain',
          value: 'Welcome',
        },
        expectedStatusCodes: [200],
      }

      const body = '<html><body>Welcome</body></html>'
      const result = evaluateOutcome({ statusCode: 200, latencyMs: 100, body }, config)

      expect(result.ok).toBe(true)
      expect(result.reason).toBeNull()
    })
  })
})
