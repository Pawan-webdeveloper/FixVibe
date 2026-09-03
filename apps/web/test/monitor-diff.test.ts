/**
 * Monitor diff types and validation tests.
 *
 * Tests the Zod schemas that validate the diff data from the API.
 * Critical because the diff data comes from DB jsonb and must be validated.
 */

import { describe, expect, it } from 'vitest'
import {
  MonitorEventDiffSchema,
  MonitorLogEntrySchema,
  MonitorLogsResponseSchema,
  type MonitorEventDiff,
  type MonitorLogEntry,
} from '@scanlyfix/db/types/monitor-diff.ts'

describe('MonitorEventDiffSchema', () => {
  it('accepts empty diff (no changes)', () => {
    const result = MonitorEventDiffSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts statusCode diff', () => {
    const diff = {
      statusCode: { from: 200, to: 503 },
    }
    const result = MonitorEventDiffSchema.safeParse(diff)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.statusCode).toEqual({ from: 200, to: 503 })
    }
  })

  it('accepts latencyMs diff', () => {
    const diff = {
      latencyMs: { from: 150, to: 250 },
    }
    const result = MonitorEventDiffSchema.safeParse(diff)
    expect(result.success).toBe(true)
  })

  it('accepts detail diff', () => {
    const diff = {
      detail: { from: null, to: 'Connection refused' },
    }
    const result = MonitorEventDiffSchema.safeParse(diff)
    expect(result.success).toBe(true)
  })

  it('accepts all fields together', () => {
    const diff: MonitorEventDiff = {
      statusCode: { from: 200, to: 503 },
      latencyMs: { from: 150, to: 250 },
      detail: { from: null, to: 'Service unavailable' },
    }
    const result = MonitorEventDiffSchema.safeParse(diff)
    expect(result.success).toBe(true)
  })

  it('rejects invalid statusCode type', () => {
    const diff = {
      statusCode: { from: 'not a number', to: 503 },
    }
    const result = MonitorEventDiffSchema.safeParse(diff)
    expect(result.success).toBe(false)
  })

  it('rejects statusCode exceeding max length', () => {
    const diff = {
      detail: { from: null, to: 'x'.repeat(501) },
    }
    const result = MonitorEventDiffSchema.safeParse(diff)
    expect(result.success).toBe(false)
  })
})

describe('MonitorLogEntrySchema', () => {
  it('accepts valid log entry', () => {
    const entry = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      monitorId: '550e8400-e29b-41d4-a716-446655440001',
      ok: true,
      statusCode: 200,
      latencyMs: 150,
      detail: null,
      ts: '2024-01-15T10:30:00.000Z',
      diff: null,
    }
    const result = MonitorLogEntrySchema.safeParse(entry)
    expect(result.success).toBe(true)
  })

  it('accepts entry with diff', () => {
    const entry = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      monitorId: '550e8400-e29b-41d4-a716-446655440001',
      ok: false,
      statusCode: 503,
      latencyMs: null,
      detail: 'Service unavailable',
      ts: '2024-01-15T10:30:00.000Z',
      diff: {
        statusCode: { from: 200, to: 503 },
      },
    }
    const result = MonitorLogEntrySchema.safeParse(entry)
    expect(result.success).toBe(true)
  })

  it('rejects invalid UUID', () => {
    const entry = {
      id: 'not-a-uuid',
      monitorId: '550e8400-e29b-41d4-a716-446655440001',
      ok: true,
      statusCode: 200,
      latencyMs: 150,
      detail: null,
      ts: '2024-01-15T10:30:00.000Z',
      diff: null,
    }
    const result = MonitorLogEntrySchema.safeParse(entry)
    expect(result.success).toBe(false)
  })

  it('rejects invalid ISO timestamp', () => {
    const entry = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      monitorId: '550e8400-e29b-41d4-a716-446655440001',
      ok: true,
      statusCode: 200,
      latencyMs: 150,
      detail: null,
      ts: 'not-a-date',
      diff: null,
    }
    const result = MonitorLogEntrySchema.safeParse(entry)
    expect(result.success).toBe(false)
  })
})

describe('MonitorLogsResponseSchema', () => {
  it('accepts valid response with logs', () => {
    const response = {
      logs: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          monitorId: '550e8400-e29b-41d4-a716-446655440001',
          ok: true,
          statusCode: 200,
          latencyMs: 150,
          detail: null,
          ts: '2024-01-15T10:30:00.000Z',
          diff: null,
        },
      ],
    }
    const result = MonitorLogsResponseSchema.safeParse(response)
    expect(result.success).toBe(true)
  })

  it('accepts empty logs array', () => {
    const response = { logs: [] }
    const result = MonitorLogsResponseSchema.safeParse(response)
    expect(result.success).toBe(true)
  })

  it('rejects response with invalid log entry', () => {
    const response = {
      logs: [
        {
          id: 'invalid',
          monitorId: '550e8400-e29b-41d4-a716-446655440001',
          ok: true,
          statusCode: 200,
          latencyMs: 150,
          detail: null,
          ts: '2024-01-15T10:30:00.000Z',
          diff: null,
        },
      ],
    }
    const result = MonitorLogsResponseSchema.safeParse(response)
    expect(result.success).toBe(false)
  })
})
