/**
 * apps/web/test/maintenance-windows-routes.test.ts
 *
 * Tests for the four routes on /api/monitors/:id/maintenance-windows[/:wid]:
 *   - GET    list
 *   - POST   create
 *   - DELETE remove
 *   - PATCH  toggle enabled
 *
 * The pure time math has its own test file; this file covers the route
 * contracts — auth, validation, ownership.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockViewer,
  mockList,
  mockCreate,
  mockDelete,
  mockSetEnabled,
} = vi.hoisted(() => ({
  mockViewer: vi.fn(),
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockDelete: vi.fn(),
  mockSetEnabled: vi.fn(),
}))

vi.mock('@/lib/authz.ts', () => ({
  getViewer: () => mockViewer(),
}))

vi.mock('@scanlyfix/db', () => ({
  listMaintenanceWindows: (...args: unknown[]) => mockList(...args),
  createMaintenanceWindow: (...args: unknown[]) => mockCreate(...args),
  deleteMaintenanceWindow: (...args: unknown[]) => mockDelete(...args),
  setMaintenanceWindowEnabled: (...args: unknown[]) => mockSetEnabled(...args),
}))

const { GET: listWindows, POST: createWindow } = await import(
  '../app/api/monitors/[id]/maintenance-windows/route.ts'
)
const { DELETE: deleteWindow, PATCH: patchWindow } = await import(
  '../app/api/monitors/[id]/maintenance-windows/[wid]/route.ts'
)

const USER = { kind: 'user', userId: 'usr-1', email: 'o@example.com' }
const ANON = { kind: 'anonymous' }
const MONITOR_ID = '550e8400-e29b-41d4-a716-446655440000'
const WINDOW_ID = '660e8400-e29b-41d4-a716-446655440001'

function ctx() {
  return { params: Promise.resolve({ id: MONITOR_ID }) }
}

function ctxWindow() {
  return { params: Promise.resolve({ id: MONITOR_ID, wid: WINDOW_ID }) }
}

const validBody = {
  dayOfWeek: 0,
  startTime: '02:00',
  durationMin: 120,
  timezone: 'America/Los_Angeles',
  reason: 'Deploy window',
}

beforeEach(() => {
  mockViewer.mockReset()
  mockList.mockReset()
  mockCreate.mockReset()
  mockDelete.mockReset()
  mockSetEnabled.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/monitors/:id/maintenance-windows', () => {
  it('returns 401 for anonymous viewer', async () => {
    mockViewer.mockResolvedValue(ANON)
    const res = await listWindows(
      new Request('http://app.test'),
      ctx(),
    )
    expect(res.status).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('returns the windows for an authorised viewer', async () => {
    mockViewer.mockResolvedValue(USER)
    mockList.mockResolvedValue([{ id: WINDOW_ID, ...validBody }])
    const res = await listWindows(new Request('http://app.test'), ctx())
    expect(res.status).toBe(200)
    expect((await res.json()).windows).toHaveLength(1)
  })
})

describe('POST /api/monitors/:id/maintenance-windows', () => {
  it('returns 401 for anonymous viewer', async () => {
    mockViewer.mockResolvedValue(ANON)
    const req = new Request('http://app.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    const res = await createWindow(req, ctx())
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    mockViewer.mockResolvedValue(USER)
    const req = new Request('http://app.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await createWindow(req, ctx())
    expect(res.status).toBe(400)
  })

  it('returns 400 when dayOfWeek is out of range', async () => {
    mockViewer.mockResolvedValue(USER)
    const req = new Request('http://app.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, dayOfWeek: 7 }),
    })
    const res = await createWindow(req, ctx())
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 400 when duration is < 5 min or > 24h', async () => {
    mockViewer.mockResolvedValue(USER)
    for (const durationMin of [0, 4, 1440, 10000]) {
      const req = new Request('http://app.test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, durationMin }),
      })
      const res = await createWindow(req, ctx())
      expect(res.status).toBe(400)
    }
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 400 when timezone is unknown', async () => {
    mockViewer.mockResolvedValue(USER)
    const req = new Request('http://app.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, timezone: 'Atlantis/Avalon' }),
    })
    const res = await createWindow(req, ctx())
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 400 for an out-of-range startTime', async () => {
    mockViewer.mockResolvedValue(USER)
    const req = new Request('http://app.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, startTime: '25:00' }),
    })
    const res = await createWindow(req, ctx())
    expect(res.status).toBe(400)
  })

  it('returns 404 when the monitor does not exist for the viewer', async () => {
    mockViewer.mockResolvedValue(USER)
    mockCreate.mockResolvedValue(null)
    const req = new Request('http://app.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    const res = await createWindow(req, ctx())
    expect(res.status).toBe(404)
  })

  it('returns 200 with the created row on success', async () => {
    mockViewer.mockResolvedValue(USER)
    const created = { id: WINDOW_ID, ...validBody, enabled: true }
    mockCreate.mockResolvedValue(created)
    const req = new Request('http://app.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    })
    const res = await createWindow(req, ctx())
    expect(res.status).toBe(200)
    expect((await res.json()).window).toEqual(created)
  })
})

describe('DELETE /api/monitors/:id/maintenance-windows/:wid', () => {
  it('returns 401 for anonymous viewer', async () => {
    mockViewer.mockResolvedValue(ANON)
    const res = await deleteWindow(
      new Request('http://app.test', { method: 'DELETE' }),
      ctxWindow(),
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 when the window does not exist for the viewer', async () => {
    mockViewer.mockResolvedValue(USER)
    mockDelete.mockResolvedValue(false)
    const res = await deleteWindow(
      new Request('http://app.test', { method: 'DELETE' }),
      ctxWindow(),
    )
    expect(res.status).toBe(404)
  })

  it('returns 200 on success', async () => {
    mockViewer.mockResolvedValue(USER)
    mockDelete.mockResolvedValue(true)
    const res = await deleteWindow(
      new Request('http://app.test', { method: 'DELETE' }),
      ctxWindow(),
    )
    expect(res.status).toBe(200)
    expect((await res.json())).toEqual({ ok: true })
    expect(mockDelete).toHaveBeenCalledWith(WINDOW_ID, USER)
  })
})

describe('PATCH /api/monitors/:id/maintenance-windows/:wid', () => {
  it('returns 401 for anonymous viewer', async () => {
    mockViewer.mockResolvedValue(ANON)
    const req = new Request('http://app.test', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    const res = await patchWindow(req, ctxWindow())
    expect(res.status).toBe(401)
  })

  it('returns 400 when enabled is not a boolean', async () => {
    mockViewer.mockResolvedValue(USER)
    const req = new Request('http://app.test', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes' }),
    })
    const res = await patchWindow(req, ctxWindow())
    expect(res.status).toBe(400)
  })

  it('returns 404 when the window does not exist for the viewer', async () => {
    mockViewer.mockResolvedValue(USER)
    mockSetEnabled.mockResolvedValue(null)
    const req = new Request('http://app.test', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    const res = await patchWindow(req, ctxWindow())
    expect(res.status).toBe(404)
  })

  it('returns 200 with the updated row on success', async () => {
    mockViewer.mockResolvedValue(USER)
    const updated = { id: WINDOW_ID, ...validBody, enabled: false }
    mockSetEnabled.mockResolvedValue(updated)
    const req = new Request('http://app.test', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    const res = await patchWindow(req, ctxWindow())
    expect(res.status).toBe(200)
    expect((await res.json()).window).toEqual(updated)
    expect(mockSetEnabled).toHaveBeenCalledWith(WINDOW_ID, false, USER)
  })
})
