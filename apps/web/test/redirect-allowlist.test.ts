import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Tests for SUPABASE_REDIRECT_ALLOWLIST parsing in lib/env.ts.
 *
 * The parser runs once on import; tests that need a specific env shape load
 * the module via a fresh `import()` after mutating `process.env`, which is
 * how Vitest handles a module that captures `process.env` at module
 * evaluation time.
 */

const ORIGINAL_ENV = { ...process.env }

async function loadEnvModule() {
  // The `server-only` import in env.ts is stubbed via the vitest alias to a
  // no-op, so the module is safe to import here. A fresh import per test
  // means `process.env` is re-read, which is what the test wants.
  const mod = await import('@/lib/env.ts')
  return mod.serverEnv
}

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
  // Required for the module to even reach the redirectAllowlist getter.
  process.env.DATABASE_URL = 'postgresql://x'
  process.env.IP_HASH_SALT = 'x'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x'
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.com'
})

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
})

describe('serverEnv.redirectAllowlist', () => {
  it('returns an empty array when the env var is unset', async () => {
    delete process.env.SUPABASE_REDIRECT_ALLOWLIST
    const env = await loadEnvModule()
    expect(env.redirectAllowlist).toEqual([])
  })

  it('parses a valid JSON array of strings', async () => {
    process.env.SUPABASE_REDIRECT_ALLOWLIST = JSON.stringify([
      'https://example.com/auth/callback',
      'http://localhost:3000/auth/callback',
    ])
    const env = await loadEnvModule()
    expect(env.redirectAllowlist).toEqual([
      'https://example.com/auth/callback',
      'http://localhost:3000/auth/callback',
    ])
  })

  it('throws on invalid JSON', async () => {
    process.env.SUPABASE_REDIRECT_ALLOWLIST = 'not-json'
    const env = await loadEnvModule()
    expect(() => env.redirectAllowlist).toThrow(/not valid JSON/)
  })

  it('throws when the value is not an array', async () => {
    process.env.SUPABASE_REDIRECT_ALLOWLIST = JSON.stringify({ url: 'https://x' })
    const env = await loadEnvModule()
    expect(() => env.redirectAllowlist).toThrow(/must be a JSON array of strings/)
  })

  it('throws when an array entry is not a string', async () => {
    process.env.SUPABASE_REDIRECT_ALLOWLIST = JSON.stringify(['https://x', 42])
    const env = await loadEnvModule()
    expect(() => env.redirectAllowlist).toThrow(/must be a JSON array of strings/)
  })
})

describe('serverEnv.appUrl', () => {
  it('throws when NEXT_PUBLIC_APP_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    const env = await loadEnvModule()
    expect(() => env.appUrl).toThrow(/NEXT_PUBLIC_APP_URL/)
  })

  it('returns the value when set', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://scanlyfix.com'
    const env = await loadEnvModule()
    expect(env.appUrl).toBe('https://scanlyfix.com')
  })
})
