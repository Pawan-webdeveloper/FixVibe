/**
 * apps/web/test/discord.test.ts
 *
 * Discord channel — the four contracts that matter:
 *   1. URL validation: discord.com / discordapp.com only, /api/webhooks/{id}/{token} shape
 *   2. renderDiscord: embed color matches severity, fields populated, schema-valid
 *   3. sendDiscord: never throws on transport error, returns structured result
 *   4. URL is never logged on failure
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const {
  sendDiscord,
  renderDiscord,
  isValidDiscordWebhookUrl,
  DiscordMessageSchema,
  DiscordEmbedSchema,
} = await import('../lib/discord.ts')

const VALID_URL = 'https://discord.com/api/webhooks/1234567890/abcdefghij_token'
const LEGACY_URL = 'https://discordapp.com/api/webhooks/1234567890/abcdefghij_token'

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
})

afterEach(() => vi.restoreAllMocks())

describe('isValidDiscordWebhookUrl', () => {
  it('accepts a well-formed discord.com URL', () => {
    expect(isValidDiscordWebhookUrl(VALID_URL)).toBe(true)
  })

  it('accepts the legacy discordapp.com host', () => {
    expect(isValidDiscordWebhookUrl(LEGACY_URL)).toBe(true)
  })

  it('rejects http URLs', () => {
    expect(isValidDiscordWebhookUrl('http://discord.com/api/webhooks/1/abc')).toBe(false)
  })

  it('rejects non-Discord hosts', () => {
    expect(isValidDiscordWebhookUrl('https://example.com/api/webhooks/1/abc')).toBe(false)
    expect(isValidDiscordWebhookUrl('https://evil-discord.com/api/webhooks/1/abc')).toBe(false)
  })

  it('rejects URLs with the wrong path', () => {
    expect(isValidDiscordWebhookUrl('https://discord.com/foo/1/abc')).toBe(false)
    expect(isValidDiscordWebhookUrl('https://discord.com/api/webhooks/')).toBe(false)
  })

  it('rejects URLs with embedded credentials', () => {
    expect(isValidDiscordWebhookUrl('https://user:pass@discord.com/api/webhooks/1/abc')).toBe(false)
  })

  it('rejects malformed strings', () => {
    expect(isValidDiscordWebhookUrl('not a url')).toBe(false)
    expect(isValidDiscordWebhookUrl('')).toBe(false)
  })
})

describe('renderDiscord', () => {
  const base = {
    projectName: 'Acme',
    projectUrl: 'https://acme.test/',
    text: 'Acme has failed 3 consecutive checks.\n\nStatus page: https://app/acme',
  }

  it('produces a red embed for downtime', () => {
    const msg = renderDiscord({ ...base, kind: 'downtime' })
    expect(msg.embeds).toHaveLength(1)
    const embed = msg.embeds![0]!
    // Red = 0xDC3545
    expect(embed.color).toBe(0xdc3545)
    expect(embed.title).toMatch(/downtime/)
    expect(embed.description).toBe(base.text)
  })

  it('produces a green embed for recovered', () => {
    const msg = renderDiscord({ ...base, kind: 'recovered' })
    expect(msg.embeds![0]!.color).toBe(0x57f287)
  })

  it('produces an amber embed for warnings', () => {
    const warnKinds = ['downtime-reminder', 'web_vitals', 'score-drop', 'dns_drift']
    for (const kind of warnKinds) {
      const msg = renderDiscord({ ...base, kind })
      // Amber = 0xFBA618
      expect(msg.embeds![0]!.color).toBe(0xfba618)
    }
  })

  it('produces a red embed for certificate/domain expiry', () => {
    const criticalKinds = ['tls_expiring', 'domain_expiring', 'certificate-expiry-expired', 'domain-expiry-expired']
    for (const kind of criticalKinds) {
      const msg = renderDiscord({ ...base, kind })
      expect(msg.embeds![0]!.color).toBe(0xdc3545)
    }
  })

  it('produces a blue embed for unknown kinds', () => {
    const msg = renderDiscord({ ...base, kind: 'something-new' })
    expect(msg.embeds![0]!.color).toBe(0x5865f2)
  })

  it('populates project + URL fields', () => {
    const msg = renderDiscord({ ...base, kind: 'downtime' })
    const fields = msg.embeds![0]!.fields ?? []
    const projectField = fields.find((f) => f.name === 'Project')
    const urlField = fields.find((f) => f.name === 'URL')
    expect(projectField?.value).toBe('Acme')
    expect(urlField?.value).toBe('https://acme.test/')
  })

  it('uses ScanlyFix as the bot username', () => {
    const msg = renderDiscord({ ...base, kind: 'downtime' })
    expect(msg.username).toBe('ScanlyFix')
  })

  it('includes a content fallback under 2000 chars', () => {
    const msg = renderDiscord({ ...base, kind: 'downtime' })
    expect(msg.content.length).toBeLessThanOrEqual(2000)
    expect(msg.content.length).toBeGreaterThan(0)
  })

  it('produces a message that passes the Zod schema', () => {
    const msg = renderDiscord({ ...base, kind: 'downtime' })
    const parsed = DiscordMessageSchema.safeParse(msg)
    expect(parsed.success).toBe(true)
  })

  it('truncates an over-long description safely', () => {
    const hugeText = 'x'.repeat(5000)
    const msg = renderDiscord({ ...base, kind: 'downtime', text: hugeText })
    expect(msg.embeds![0]!.description.length).toBeLessThanOrEqual(4096)
  })
})

describe('sendDiscord', () => {
  const message = renderDiscord({
    kind: 'downtime',
    projectName: 'Acme',
    projectUrl: 'https://acme.test/',
    text: 'Site is down',
    payload: null,
  })

  it('POSTs JSON to the webhook URL on success', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    const result = await sendDiscord(VALID_URL, message)
    expect(result.sent).toBe(true)

    const [url, opts] = fetchMock.mock.calls[0]!
    expect(url).toBe(VALID_URL)
    expect(opts.method).toBe('POST')
    expect(opts.headers['Content-Type']).toBe('application/json')
    // 10s timeout
    expect((opts.signal as AbortSignal).aborted).toBe(false)
    expect(JSON.parse(opts.body)).toMatchObject({
      username: 'ScanlyFix',
      embeds: expect.any(Array),
    })
  })

  it('returns sent:false on 4xx without throwing', async () => {
    fetchMock.mockResolvedValue(new Response('bad request', { status: 400 }))

    const result = await sendDiscord(VALID_URL, message)
    expect(result.sent).toBe(false)
    expect(result.reason).toContain('400')
  })

  it('returns sent:false on 5xx without throwing', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }))

    const result = await sendDiscord(VALID_URL, message)
    expect(result.sent).toBe(false)
    expect(result.reason).toContain('500')
  })

  it('returns sent:false on timeout without throwing', async () => {
    fetchMock.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          const err = new Error('aborted')
          err.name = 'TimeoutError'
          // Reject on the next tick so the test is fast and deterministic
          setTimeout(() => reject(err), 0)
        }),
    )

    const result = await sendDiscord(VALID_URL, message)
    expect(result.sent).toBe(false)
    expect(result.reason).toMatch(/timed out/i)
  })

  it('refuses to send to a non-Discord URL', async () => {
    const result = await sendDiscord('https://example.com/hook', message)
    expect(result.sent).toBe(false)
    expect(result.reason).toMatch(/disallowed|Invalid/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses to send a malformed message', async () => {
    const bad = { content: '', embeds: [] } as unknown as Parameters<typeof sendDiscord>[1]
    const result = await sendDiscord(VALID_URL, bad)
    expect(result.sent).toBe(false)
    expect(result.reason).toMatch(/Invalid/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never logs the URL on failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))

    await sendDiscord(VALID_URL, message)

    // Every console.warn call must not contain the full URL
    for (const call of warnSpy.mock.calls) {
      const text = String(call[0] ?? '')
      expect(text).not.toContain(VALID_URL)
    }
    warnSpy.mockRestore()
  })
})

describe('DiscordEmbedSchema', () => {
  it('rejects an over-large color value', () => {
    const r = DiscordEmbedSchema.safeParse({
      title: 't',
      description: 'd',
      color: 0x1000000,
    })
    expect(r.success).toBe(false)
  })
})
