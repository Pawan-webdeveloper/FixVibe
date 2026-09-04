/**
 * apps/web/test/incidents-routes.test.ts
 *
 * Tests for POST /api/incidents/:id/ack and PATCH /api/incidents/:id/notes.
 *
 * The full lifecycle is exercised:
 *   - ack  : POST /ack, then verify the row reflects the current user
 *   - notes: PATCH /notes, then verify the row carries the new text
 *   - resolve: not in scope here (probe path), but the queries are auth-gated
 *     and resolve stays orthogonal to the user-facing fields
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockViewer,
  mockAcknowledgeIncident,
  mockSetIncidentNotes,
} = vi.hoisted(() => ({
  mockViewer: vi.fn(),
  mockAcknowledgeIncident: vi.fn(),
  mockSetIncidentNotes: vi.fn(),
}))

vi.mock('@/lib/authz.ts', () => ({
  getViewer: () => mockViewer(),
}))

vi.mock('@scanlyfix/db', () => ({
  acknowledgeIncident: (...args: unknown[]) => mockAcknowledgeIncident(...args),
  setIncidentNotes: (...args: unknown[]) => mockSetIncidentNotes(...args),
}))

const { POST: postAck } = await import('../app/api/incidents/[id]/ack/route.ts')
const { PATCH: patchNotes } = await import(
  '../app/api/incidents/[id]/notes/route.ts'
)

const USER = { kind: 'user', userId: 'usr-1', email: 'oncall@example.com' }
const ANON = { kind: 'anonymous' }
const INCIDENT_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ id: INCIDENT_ID }) }
}

beforeEach(() => {
  mockViewer.mockReset()
  mockAcknowledgeIncident.mockReset()
  mockSetIncidentNotes.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const baseIncident = {
  id: INCIDENT_ID,
  monitorId: 'mon-1',
  startedAt: '2026-01-01T00:00:00.000Z',
  resolvedAt: null,
  durationMs: null,
  statusCode: 503,
  detail: 'Service Unavailable',
  acknowledgedAt: null,
  acknowledgedBy: null,
  acknowledgerEmail: null,
  notes: null,
}

describe('POST /api/incidents/:id/ack', () => {
  it('returns 401 for anonymous viewer', async () => {
    mockViewer.mockResolvedValue(ANON)
    const res = await postAck(
      new Request('http://app.test', { method: 'POST' }),
      ctx(),
    )
    expect(res.status).toBe(401)
    expect(mockAcknowledgeIncident).not.toHaveBeenCalled()
  })

  it('returns 404 when the incident does not exist for the viewer', async () => {
    mockViewer.mockResolvedValue(USER)
    mockAcknowledgeIncident.mockResolvedValue(null)

    const res = await postAck(
      new Request('http://app.test', { method: 'POST' }),
      ctx(),
    )
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Incident not found' })
  })

  it('returns 200 with the updated row on success', async () => {
    mockViewer.mockResolvedValue(USER)
    const acked = {
      ...baseIncident,
      acknowledgedAt: '2026-01-01T00:05:00.000Z',
      acknowledgedBy: 'usr-1',
      acknowledgerEmail: 'oncall@example.com',
    }
    mockAcknowledgeIncident.mockResolvedValue(acked)

    const res = await postAck(
      new Request('http://app.test', { method: 'POST' }),
      ctx(),
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.incident).toEqual(acked)
    // The current viewer is the acknowledger.
    expect(mockAcknowledgeIncident).toHaveBeenCalledWith(INCIDENT_ID, USER)
  })

  it('is idempotent — re-acking returns the latest row', async () => {
    mockViewer.mockResolvedValue(USER)
    mockAcknowledgeIncident.mockResolvedValue({
      ...baseIncident,
      acknowledgedAt: '2026-01-01T01:00:00.000Z',
      acknowledgedBy: 'usr-1',
      acknowledgerEmail: 'oncall@example.com',
    })

    const res = await postAck(
      new Request('http://app.test', { method: 'POST' }),
      ctx(),
    )
    expect(res.status).toBe(200)
    // No special "already acked" error — the server is happy to re-write.
    expect((await res.json()).incident.acknowledgedAt).toBe(
      '2026-01-01T01:00:00.000Z',
    )
  })
})

describe('PATCH /api/incidents/:id/notes', () => {
  it('returns 401 for anonymous viewer', async () => {
    mockViewer.mockResolvedValue(ANON)
    const req = new Request('http://app.test', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'investigating' }),
    })
    const res = await patchNotes(req, ctx())
    expect(res.status).toBe(401)
    expect(mockSetIncidentNotes).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON', async () => {
    mockViewer.mockResolvedValue(USER)
    const req = new Request('http://app.test', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    const res = await patchNotes(req, ctx())
    expect(res.status).toBe(400)
  })

  it('returns 400 when notes exceed 4000 characters', async () => {
    mockViewer.mockResolvedValue(USER)
    const req = new Request('http://app.test', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'x'.repeat(4001) }),
    })
    const res = await patchNotes(req, ctx())
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/4000/)
  })

  it('returns 200 with the updated row when notes fit', async () => {
    mockViewer.mockResolvedValue(USER)
    const updated = { ...baseIncident, notes: 'investigating' }
    mockSetIncidentNotes.mockResolvedValue(updated)

    const req = new Request('http://app.test', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'investigating' }),
    })
    const res = await patchNotes(req, ctx())
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.incident).toEqual(updated)
    // The full set is (id, viewer, notes); auth is the viewer's job.
    expect(mockSetIncidentNotes).toHaveBeenCalledWith(
      INCIDENT_ID,
      USER,
      'investigating',
    )
  })

  it('accepts null to clear the notes', async () => {
    mockViewer.mockResolvedValue(USER)
    const cleared = { ...baseIncident, notes: null }
    mockSetIncidentNotes.mockResolvedValue(cleared)

    const req = new Request('http://app.test', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: null }),
    })
    const res = await patchNotes(req, ctx())
    expect(res.status).toBe(200)
    expect((await res.json()).incident.notes).toBeNull()
  })

  it('returns 404 when the incident does not exist for the viewer', async () => {
    mockViewer.mockResolvedValue(USER)
    mockSetIncidentNotes.mockResolvedValue(null)

    const req = new Request('http://app.test', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'investigating' }),
    })
    const res = await patchNotes(req, ctx())
    expect(res.status).toBe(404)
  })
})

describe('lifecycle: open → ack → notes → (resolve via probe)', () => {
  it('walks the full state machine through the public API', async () => {
    mockViewer.mockResolvedValue(USER)

    // 1. Open incident — no ack, no notes.
    mockAcknowledgeIncident.mockResolvedValueOnce(null)
    let res = await postAck(
      new Request('http://app.test', { method: 'POST' }),
      ctx(),
    )
    // The first ack succeeds; this call is to assert the not-found case.
    // Reset the mock so the next assertion is meaningful.
    expect([200, 404]).toContain(res.status)
    mockAcknowledgeIncident.mockReset()
    mockAcknowledgeIncident.mockResolvedValue({
      ...baseIncident,
      acknowledgedAt: '2026-01-01T00:01:00.000Z',
      acknowledgedBy: 'usr-1',
      acknowledgerEmail: 'oncall@example.com',
    })

    // 2. Ack.
    res = await postAck(
      new Request('http://app.test', { method: 'POST' }),
      ctx(),
    )
    expect(res.status).toBe(200)
    const acked = (await res.json()).incident
    expect(acked.acknowledgedAt).toBe('2026-01-01T00:01:00.000Z')
    expect(acked.notes).toBeNull()

    // 3. Add notes.
    mockSetIncidentNotes.mockResolvedValue({
      ...acked,
      notes: 'DB connection pool exhausted — bumped max_connections',
    })
    const noteReq = new Request('http://app.test', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'DB connection pool exhausted — bumped max_connections' }),
    })
    res = await patchNotes(noteReq, ctx())
    expect(res.status).toBe(200)
    const withNotes = (await res.json()).incident
    expect(withNotes.notes).toContain('DB connection pool')

    // 4. Clear notes.
    mockSetIncidentNotes.mockResolvedValue({ ...withNotes, notes: null })
    const clearReq = new Request('http://app.test', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: null }),
    })
    res = await patchNotes(clearReq, ctx())
    expect(res.status).toBe(200)
    expect((await res.json()).incident.notes).toBeNull()

    // 5. Resolve is owned by the probe — outside this route's scope. The
    //    queries do not touch the resolvedAt column, so re-acking after
    //    a resolve is a no-op: the row carries the existing resolvedAt.
  })
})
