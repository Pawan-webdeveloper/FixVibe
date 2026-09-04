/**
 * apps/web/test/webhook.test.ts
 *
 * Webhook sender — the four contracts that matter:
 *   1. URL validation rejects http, private IPs, bad shapes
 *   2. SSRF guard rejects private hosts before any network call
 *   3. Payload is the documented JSON shape, HMAC-signed when secret set
 *   4. Failure paths (timeout, 4xx, 5xx) return sent:false without throwing
 *      and 5xx triggers exactly one retry
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SsrfError } from '@scanlyfix/checks'

const fetchMock = vi.fn()

vi.mock('@scanlyfix/checks', async () => {
  const actual = await vi.importActual<typeof import('@scanlyfix/checks')>('@scanlyfix/checks')
  return {
    ...actual,
    assertSafeUrl: vi.fn(),
    resolvePublicAddresses: vi.fn(),
  }
})

vi.stubGlobal('fetch', fetchMock)

const { sendWebhook, buildWebhookPayload, isValidWebhookUrl, severityForKind } =
  await import('../lib/webhook.ts')

const { assertSafeUrl, resolvePublicAddresses } = await import('@scanlyfix/checks')

const basePayload = {
  kind: 'downtime',
  projectName: 'ScanlyFix',
  monitorType: 'uptime',
  url: 'https://scanlyfix.test/',
  payload: { streak: 3 },
  timestamp: '2026-01-01T00:00:00.000Z',
  severity: 'critical' as const,
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.mocked(assertSafeUrl).mockReset()
  vi.mocked(resolvePublicAddresses).mockReset()
  vi.mocked(assertSafeUrl).mockImplementation(() => undefined)
  vi.mocked(resolvePublicAddresses).mockResolvedValue([
    { address: '93.184.216.34', family: 4 },
  ])
  fetchMock.mockResolvedValue(new Response('', { status: 200 }))
})

afterEach(() => vi.restoreAllMocks())

describe('isValidWebhookUrl', () => {
  it('accepts a public https URL', () => {
    expect(isValidWebhookUrl('https://webhook.site/abc-123')).toBe(true)
  })

  it('rejects http URLs (https only)', () => {
    expect(isValidWebhookUrl('http://webhook.site/abc-123')).toBe(false)
  })

  it('rejects non-http(s) protocols', () => {
    expect(isValidWebhookUrl('ftp://webhook.site/abc-123')).toBe(false)
    expect(isValidWebhookUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects URLs with embedded credentials', () => {
    expect(isValidWebhookUrl('https://user:pass@webhook.site/abc')).toBe(false)
  })

  it('rejects malformed strings', () => {
    expect(isValidWebhookUrl('not a url')).toBe(false)
    expect(isValidWebhookUrl('')).toBe(false)
  })
})

describe('severityForKind', () => {
  it('maps critical kinds', () => {
    expect(severityForKind('downtime')).toBe('critical')
    expect(severityForKind('tls_expiring')).toBe('critical')
    expect(severityForKind('certificate-expiry-expired')).toBe('critical')
  })

  it('maps warning kinds', () => {
    expect(severityForKind('recovered')).toBe('warning')
    expect(severityForKind('web_vitals')).toBe('warning')
  })

  it('defaults to info for unknown kinds', () => {
    expect(severityForKind('something-new')).toBe('info')
  })
})

describe('buildWebhookPayload', () => {
  it('produces the standardized JSON shape with severity auto-mapped from kind', () => {
    const result = buildWebhookPayload({
      kind: 'downtime',
      projectName: 'Acme',
      monitorType: 'uptime',
      url: 'https://acme.test/',
      payload: { streak: 5 },
    })
    expect(result.kind).toBe('downtime')
    expect(result.severity).toBe('critical')
    expect(result.projectName).toBe('Acme')
    expect(result.monitorType).toBe('uptime')
    expect(result.url).toBe('https://acme.test/')
    expect(result.payload).toEqual({ streak: 5 })
    // ISO 8601 with offset
    expect(() => new Date(result.timestamp)).not.toThrow()
  })
})

describe('sendWebhook', () => {
  it('posts a JSON payload with the documented headers', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))

    const result = await sendWebhook(
      { url: 'https://webhook.site/abc-123' },
      basePayload,
    )

    expect(result).toEqual({ sent: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://webhook.site/abc-123')
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('application/json')
    expect(init.headers['x-scanlyfix-event']).toBe('downtime')
    expect(init.headers['x-webhook-secret']).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual(basePayload)
  })

  it('signs the body with HMAC-SHA256 when a secret is set', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }))

    const result = await sendWebhook(
      { url: 'https://webhook.site/abc', secret: 'super-secret-key' },
      basePayload,
    )

    expect(result.sent).toBe(true)
    const [, init] = fetchMock.mock.calls[0]!
    const signature = init.headers['x-webhook-secret'] as string
    // SHA-256 hex = 64 chars
    expect(signature).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects non-https URLs without contacting the network', async () => {
    const result = await sendWebhook(
      { url: 'http://webhook.site/abc' },
      basePayload,
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toMatch(/Invalid|disallowed/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects URLs that fail SSRF validation', async () => {
    vi.mocked(assertSafeUrl).mockImplementation(() => {
      throw new SsrfError('Refusing to scan private or reserved address: 127.0.0.1')
    })

    const result = await sendWebhook(
      { url: 'https://127.0.0.1/hook' },
      basePayload,
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('URL failed SSRF validation')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects hosts that resolve to a private address', async () => {
    vi.mocked(resolvePublicAddresses).mockRejectedValue(
      new SsrfError('Refusing to scan evil.test: it resolves to private address 10.0.0.1'),
    )

    const result = await sendWebhook(
      { url: 'https://evil.test/hook' },
      basePayload,
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('URL failed SSRF validation')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns sent:false on 4xx without retrying', async () => {
    fetchMock.mockResolvedValue(new Response('bad request', { status: 400 }))

    const result = await sendWebhook(
      { url: 'https://webhook.site/abc' },
      basePayload,
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('400')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries once on 5xx, then gives up', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 502 }))

    const result = await sendWebhook(
      { url: 'https://webhook.site/abc' },
      basePayload,
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('502')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries once on network error, then gives up', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))

    const result = await sendWebhook(
      { url: 'https://webhook.site/abc' },
      basePayload,
    )

    expect(result.sent).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns sent:false on timeout without throwing', async () => {
    fetchMock.mockImplementation(
      () => new Promise((_resolve, reject) => {
        setTimeout(() => {
          const err = new Error('aborted')
          err.name = 'TimeoutError'
          reject(err)
        }, 5)
      }),
    )

    const result = await sendWebhook(
      { url: 'https://webhook.site/abc' },
      basePayload,
    )

    expect(result.sent).toBe(false)
    expect(result.reason).toMatch(/timed out/i)
  })
})
