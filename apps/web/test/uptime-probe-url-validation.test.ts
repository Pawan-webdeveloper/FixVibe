import { describe, it, expect, vi, beforeEach } from 'vitest'
import { uptimeProbe } from '../inngest/functions/uptime-probe'

// Mock the dependencies
vi.mock('@scanlyfix/checks', () => ({
  safeFetch: vi.fn(),
}))

vi.mock('@scanlyfix/db', () => ({
  consecutiveFailures: vi.fn(),
  createIncident: vi.fn(),
  isMonitorSnoozed: vi.fn(),
  recordAlertOnce: vi.fn(),
  recordMonitorRun: vi.fn(),
  resolveIncident: vi.fn(),
  db: {
    query: {
      monitors: {
        findFirst: vi.fn(),
      },
    },
  },
  monitors: {},
}))

vi.mock('@/lib/alert-email.ts', () => ({
  deliverAlert: vi.fn(),
}))

vi.mock('@/lib/inngest.ts', () => ({
  inngest: {
    createFunction: vi.fn((_config: any, handler: any) => handler),
  },
  EVENTS: {
    monitorDue: 'monitor.due',
  },
}))

vi.mock('@/lib/alert-threshold.ts', () => ({
  evaluateOutcome: vi.fn(),
  AlertConfigSchema: {
    safeParse: vi.fn(),
  },
}))

describe('uptimeProbe — malformed URL handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error for malformed URL', async () => {
    // Arrange
    const event = {
      data: {
        monitorId: 'mon-1',
        projectId: 'proj-1',
        url: 'not-a-valid-url',
      },
    }

    // Act
    const result = await (uptimeProbe as any)({ event, step: {} as any })

    // Assert
    expect(result).toEqual({ ok: false, error: 'unparseable project URL' })
  })

  it('returns error for empty URL', async () => {
    // Arrange
    const event = {
      data: {
        monitorId: 'mon-1',
        projectId: 'proj-1',
        url: '',
      },
    }

    // Act
    const result = await (uptimeProbe as any)({ event, step: {} as any })

    // Assert
    expect(result).toEqual({ ok: false, error: 'unparseable project URL' })
  })

  it('returns error for URL with missing protocol', async () => {
    // Arrange
    const event = {
      data: {
        monitorId: 'mon-1',
        projectId: 'proj-1',
        url: 'example.com',
      },
    }

    // Act
    const result = await (uptimeProbe as any)({ event, step: {} as any })

    // Assert
    expect(result).toEqual({ ok: false, error: 'unparseable project URL' })
  })
})