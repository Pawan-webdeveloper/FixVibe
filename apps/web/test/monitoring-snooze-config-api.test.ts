/**
 * Tests for Monitor Snooze and Config API Routes.
 *
 * Covers:
 *   1. /api/monitors/:id/snooze (GET, POST, DELETE)
 *   2. /api/monitors/:id/config (GET, PATCH)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GET as getSnooze,
  POST as postSnooze,
  DELETE as deleteSnooze,
} from '../app/api/monitors/[id]/snooze/route.ts'
import {
  GET as getConfig,
  PATCH as patchConfig,
} from '../app/api/monitors/[id]/config/route.ts'

const {
  mockViewer,
  mockGetActiveSnooze,
  mockSnoozeMonitor,
  mockUnsnoozeMonitor,
  mockFindFirstMonitor,
  mockFindFirstProject,
  mockUpdateMonitors,
} = vi.hoisted(() => ({
  mockViewer: vi.fn(),
  mockGetActiveSnooze: vi.fn(),
  mockSnoozeMonitor: vi.fn(),
  mockUnsnoozeMonitor: vi.fn(),
  mockFindFirstMonitor: vi.fn(),
  mockFindFirstProject: vi.fn(),
  mockUpdateMonitors: vi.fn(),
}))

vi.mock('@/lib/authz.ts', () => ({
  getViewer: () => mockViewer(),
}))

vi.mock('@scanlyfix/db', () => ({
  getActiveSnooze: (...args: unknown[]) => mockGetActiveSnooze(...args),
  snoozeMonitor: (...args: unknown[]) => mockSnoozeMonitor(...args),
  unsnoozeMonitor: (...args: unknown[]) => mockUnsnoozeMonitor(...args),
  db: {
    query: {
      monitors: { findFirst: (...args: unknown[]) => mockFindFirstMonitor(...args) },
      projects: { findFirst: (...args: unknown[]) => mockFindFirstProject(...args) },
    },
    update: () => ({
      set: () => ({
        where: (...args: unknown[]) => mockUpdateMonitors(...args),
      }),
    }),
  },
  monitors: { id: 'id', projectId: 'projectId', alertConfig: 'alertConfig' },
  projects: { id: 'id', ownerId: 'ownerId' },
}))

const USER_VIEWER = { kind: 'user', userId: 'usr-1', email: 'test@example.com' }
const ANON_VIEWER = { kind: 'anonymous' }
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

beforeEach(() => {
  mockViewer.mockReset()
  mockGetActiveSnooze.mockReset()
  mockSnoozeMonitor.mockReset()
  mockUnsnoozeMonitor.mockReset()
  mockFindFirstMonitor.mockReset()
  mockFindFirstProject.mockReset()
  mockUpdateMonitors.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Snooze Route Tests ────────────────────────────────────────────────────────

describe('/api/monitors/:id/snooze', () => {
  describe('GET', () => {
    it('returns 401 for anonymous viewer', async () => {
      mockViewer.mockResolvedValue(ANON_VIEWER)
      const res = await getSnooze(new Request('http://app.test'), {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(401)
    })

    it('returns active snooze for authenticated user', async () => {
      mockViewer.mockResolvedValue(USER_VIEWER)
      const mockSnoozeData = { id: 'snz-1', monitorId: VALID_UUID, expiresAt: null }
      mockGetActiveSnooze.mockResolvedValue(mockSnoozeData)

      const res = await getSnooze(new Request('http://app.test'), {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.snooze).toEqual(mockSnoozeData)
      expect(mockGetActiveSnooze).toHaveBeenCalledWith(VALID_UUID, USER_VIEWER)
    })
  })

  describe('POST', () => {
    it('returns 401 for anonymous viewer', async () => {
      mockViewer.mockResolvedValue(ANON_VIEWER)
      const req = new Request('http://app.test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const res = await postSnooze(req, {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(401)
    })

    it('returns 400 for invalid JSON', async () => {
      mockViewer.mockResolvedValue(USER_VIEWER)
      const req = new Request('http://app.test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad-json',
      })
      const res = await postSnooze(req, {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(400)
    })

    it('rejects past timestamps with 400', async () => {
      mockViewer.mockResolvedValue(USER_VIEWER)
      const pastDate = new Date(Date.now() - 3600_000).toISOString()
      const req = new Request('http://app.test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresAt: pastDate }),
      })
      const res = await postSnooze(req, {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('future')
    })

    it('accepts indefinite snooze (expiresAt: null) and creates snooze', async () => {
      mockViewer.mockResolvedValue(USER_VIEWER)
      const mockResult = { id: 'snz-1', monitorId: VALID_UUID, expiresAt: null, reason: 'Maintenance' }
      mockSnoozeMonitor.mockResolvedValue(mockResult)

      const req = new Request('http://app.test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresAt: null, reason: 'Maintenance' }),
      })
      const res = await postSnooze(req, {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.snooze).toEqual(mockResult)
      expect(mockSnoozeMonitor).toHaveBeenCalledWith(VALID_UUID, USER_VIEWER, {
        expiresAt: null,
        reason: 'Maintenance',
      })
    })

    it('returns 404 when monitor is not found or not owned', async () => {
      mockViewer.mockResolvedValue(USER_VIEWER)
      mockSnoozeMonitor.mockResolvedValue(null)

      const req = new Request('http://app.test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresAt: null }),
      })
      const res = await postSnooze(req, {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE', () => {
    it('returns 401 for anonymous viewer', async () => {
      mockViewer.mockResolvedValue(ANON_VIEWER)
      const res = await deleteSnooze(new Request('http://app.test'), {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(401)
    })

    it('unsnoozes monitor successfully', async () => {
      mockViewer.mockResolvedValue(USER_VIEWER)
      mockUnsnoozeMonitor.mockResolvedValue(undefined)

      const res = await deleteSnooze(new Request('http://app.test'), {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
      expect(mockUnsnoozeMonitor).toHaveBeenCalledWith(VALID_UUID, USER_VIEWER)
    })
  })
})

// ─── Config Route Tests ────────────────────────────────────────────────────────

describe('/api/monitors/:id/config', () => {
  describe('GET', () => {
    it('returns 403 for anonymous viewer', async () => {
      mockViewer.mockResolvedValue(ANON_VIEWER)
      const res = await getConfig(new Request('http://app.test'), {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(403)
    })

    it('returns 400 for non-UUID monitor ID', async () => {
      mockViewer.mockResolvedValue(USER_VIEWER)
      const res = await getConfig(new Request('http://app.test'), {
        params: Promise.resolve({ id: 'not-a-uuid' }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 404 when monitor is not found', async () => {
      mockViewer.mockResolvedValue(USER_VIEWER)
      mockFindFirstMonitor.mockResolvedValue(null)

      const res = await getConfig(new Request('http://app.test'), {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(404)
    })

    it('returns 403 when project is owned by another user', async () => {
      mockViewer.mockResolvedValue(USER_VIEWER)
      mockFindFirstMonitor.mockResolvedValue({ id: VALID_UUID, projectId: 'proj-1' })
      mockFindFirstProject.mockResolvedValue({ ownerId: 'other-user' })

      const res = await getConfig(new Request('http://app.test'), {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(403)
    })

    it('returns alertConfig for project owner', async () => {
      mockViewer.mockResolvedValue(USER_VIEWER)
      mockFindFirstMonitor.mockResolvedValue({
        id: VALID_UUID,
        projectId: 'proj-1',
        alertConfig: { failStatusCodes: [500, 503], maxLatencyMs: 2000 },
      })
      mockFindFirstProject.mockResolvedValue({ ownerId: 'usr-1' })

      const res = await getConfig(new Request('http://app.test'), {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.alertConfig).toEqual({
        failStatusCodes: [500, 503],
        maxLatencyMs: 2000,
      })
    })
  })

  describe('PATCH', () => {
    it('returns 400 for invalid alertConfig', async () => {
      mockViewer.mockResolvedValue(USER_VIEWER)
      const req = new Request('http://app.test', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertConfig: { maxLatencyMs: 50 } }), // <100ms invalid
      })
      const res = await patchConfig(req, {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(400)
    })

    it('updates alertConfig for project owner', async () => {
      mockViewer.mockResolvedValue(USER_VIEWER)
      mockFindFirstMonitor.mockResolvedValue({ id: VALID_UUID, projectId: 'proj-1' })
      mockFindFirstProject.mockResolvedValue({ id: 'proj-1', ownerId: 'usr-1' })
      mockUpdateMonitors.mockResolvedValue(undefined)

      const req = new Request('http://app.test', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertConfig: { failStatusCodes: [500, 502, 503], maxLatencyMs: 3000 },
        }),
      })
      const res = await patchConfig(req, {
        params: Promise.resolve({ id: VALID_UUID }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
    })
  })
})
