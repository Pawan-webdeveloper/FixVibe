/**
 * Tests for status-page polish (Phase 6.4) — project branding queries.
 *
 * Pure-helper coverage (no DB):
 *   - isHexColor
 *   - isValidLogoUrl
 *
 * Mocked-DB coverage:
 *   - getProjectBranding (auth-gated, defaults)
 *   - updateProjectBranding (auth-gated, validation, write)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isHexColor,
  isValidLogoUrl,
  getProjectBranding,
  updateProjectBranding,
} from '../src/queries/project-branding.ts'

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                                */
/* -------------------------------------------------------------------------- */

describe('isHexColor', () => {
  it('accepts #RRGGBB', () => {
    expect(isHexColor('#1A73E8')).toBe(true)
    expect(isHexColor('#000000')).toBe(true)
    expect(isHexColor('#FFFFFF')).toBe(true)
  })

  it('accepts mixed case', () => {
    expect(isHexColor('#abcdef')).toBe(true)
    expect(isHexColor('#ABCDEF')).toBe(true)
  })

  it('rejects 3-digit hex', () => {
    expect(isHexColor('#fff')).toBe(false)
  })

  it('rejects 8-digit hex with alpha', () => {
    expect(isHexColor('#ffffffff')).toBe(false)
  })

  it('rejects named colours', () => {
    expect(isHexColor('red')).toBe(false)
    expect(isHexColor('transparent')).toBe(false)
  })

  it('rejects empty / whitespace', () => {
    expect(isHexColor('')).toBe(false)
    expect(isHexColor('   ')).toBe(false)
  })
})

describe('isValidLogoUrl', () => {
  it('accepts https URLs', () => {
    expect(isValidLogoUrl('https://cdn.example.com/logo.png')).toBe(true)
    expect(isValidLogoUrl('https://example.com/path?query=1')).toBe(true)
  })

  it('accepts base64 data URLs for the listed image types', () => {
    expect(isValidLogoUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(isValidLogoUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(true)
    expect(isValidLogoUrl('data:image/webp;base64,UklGRiQ=')).toBe(true)
  })

  it('rejects http URLs (mixed content)', () => {
    expect(isValidLogoUrl('http://example.com/logo.png')).toBe(false)
  })

  it('rejects non-image data URLs', () => {
    expect(isValidLogoUrl('data:text/html;base64,PHN2Zz4=')).toBe(false)
    expect(isValidLogoUrl('data:application/octet-stream;base64,AAAA')).toBe(false)
  })

  it('rejects javascript: and other schemes', () => {
    expect(isValidLogoUrl('javascript:alert(1)')).toBe(false)
    expect(isValidLogoUrl('file:///etc/passwd')).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* getProjectBranding (mocked DB)                                             */
/* -------------------------------------------------------------------------- */

describe('getProjectBranding', () => {
  let mockFindFirst: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    mockFindFirst = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../src/client.ts')
    vi.doUnmock('../src/queries/projects.ts')
  })

  it('returns null when the viewer does not own the project', async () => {
    vi.doMock('../src/queries/projects.ts', () => ({
      getProject: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('../src/client.ts', () => ({ db: { query: {} } }))

    const { getProjectBranding: fn } = await import('../src/queries/project-branding.ts')
    expect(await fn('proj-1', { kind: 'user', userId: 'u1' })).toBeNull()
  })

  it('returns the project branding with defaults applied', async () => {
    vi.doMock('../src/queries/projects.ts', () => ({
      getProject: vi.fn().mockResolvedValue({
        id: 'proj-1',
        logoUrl: null,
        brandColor: null,
        robotsIndexable: null, // simulate unset column
      }),
    }))
    vi.doMock('../src/client.ts', () => ({ db: { query: {} } }))

    const { getProjectBranding: fn } = await import('../src/queries/project-branding.ts')
    const result = await fn('proj-1', { kind: 'user', userId: 'u1' })
    expect(result).toEqual({
      logoUrl: null,
      brandColor: null,
      robotsIndexable: true, // default
    })
  })

  it('returns branded values verbatim when set', async () => {
    vi.doMock('../src/queries/projects.ts', () => ({
      getProject: vi.fn().mockResolvedValue({
        id: 'proj-1',
        logoUrl: 'https://cdn.test/logo.png',
        brandColor: '#FF00AA',
        robotsIndexable: false,
      }),
    }))
    vi.doMock('../src/client.ts', () => ({ db: { query: {} } }))

    const { getProjectBranding: fn } = await import('../src/queries/project-branding.ts')
    const result = await fn('proj-1', { kind: 'user', userId: 'u1' })
    expect(result).toEqual({
      logoUrl: 'https://cdn.test/logo.png',
      brandColor: '#FF00AA',
      robotsIndexable: false,
    })
  })
})

/* -------------------------------------------------------------------------- */
/* updateProjectBranding (mocked DB)                                          */
/* -------------------------------------------------------------------------- */

describe('updateProjectBranding', () => {
  let mockUpdate: ReturnType<typeof vi.fn>
  let mockSet: ReturnType<typeof vi.fn>
  let mockWhere: ReturnType<typeof vi.fn>
  let mockReturning: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    mockReturning = vi.fn(() => Promise.resolve([{}]))
    mockWhere = vi.fn(() => ({ returning: mockReturning }))
    mockSet = vi.fn(() => ({ where: mockWhere }))
    mockUpdate = vi.fn(() => ({ set: mockSet }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('../src/client.ts')
    vi.doUnmock('../src/queries/projects.ts')
  })

  it('returns null when the viewer does not own the project', async () => {
    vi.doMock('../src/queries/projects.ts', () => ({
      getProject: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('../src/client.ts', () => ({ db: { update: mockUpdate } }))

    const { updateProjectBranding: fn } = await import('../src/queries/project-branding.ts')
    expect(await fn('proj-1', { kind: 'user', userId: 'u1' }, {
      logoUrl: null,
      brandColor: '#FF0000',
      robotsIndexable: true,
    })).toBeNull()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('writes the three fields verbatim', async () => {
    mockReturning.mockResolvedValueOnce([{
      logoUrl: 'https://x.test/l.png',
      brandColor: '#FF00AA',
      robotsIndexable: false,
    }])
    vi.doMock('../src/queries/projects.ts', () => ({
      getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
    }))
    vi.doMock('../src/client.ts', () => ({ db: { update: mockUpdate } }))

    const { updateProjectBranding: fn } = await import('../src/queries/project-branding.ts')
    const result = await fn('proj-1', { kind: 'user', userId: 'u1' }, {
      logoUrl: 'https://x.test/l.png',
      brandColor: '#FF00AA',
      robotsIndexable: false,
    })

    expect(result).toEqual({
      logoUrl: 'https://x.test/l.png',
      brandColor: '#FF00AA',
      robotsIndexable: false,
    })
    expect(mockSet).toHaveBeenCalledOnce()
    const setArg = mockSet.mock.calls[0]?.[0] as Record<string, unknown>
    expect(setArg['logoUrl']).toBe('https://x.test/l.png')
    expect(setArg['brandColor']).toBe('#FF00AA')
    expect(setArg['robotsIndexable']).toBe(false)
  })

  it('writes null when the caller wants to clear a field', async () => {
    mockReturning.mockResolvedValueOnce([{
      logoUrl: null,
      brandColor: null,
      robotsIndexable: true,
    }])
    vi.doMock('../src/queries/projects.ts', () => ({
      getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
    }))
    vi.doMock('../src/client.ts', () => ({ db: { update: mockUpdate } }))

    const { updateProjectBranding: fn } = await import('../src/queries/project-branding.ts')
    const result = await fn('proj-1', { kind: 'user', userId: 'u1' }, {
      logoUrl: null,
      brandColor: null,
      robotsIndexable: true,
    })

    expect(result?.logoUrl).toBeNull()
    expect(result?.brandColor).toBeNull()
  })
})
