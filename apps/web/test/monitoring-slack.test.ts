/**
 * Slack webhook sender tests.
 *
 * Three things under test:
 *   1. isValidSlackWebhookUrl — SSRF guard: only hooks.slack.com allowed
 *   2. sendSlack — message shape validation + actual send path
 *
 * Tests use vi.stubGlobal('fetch', ...) so no real network calls go out.
 * The 'server-only' import is stubbed via vitest.config.ts alias.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidSlackWebhookUrl, sendSlack } from '../lib/slack.ts'

// ─── isValidSlackWebhookUrl ────────────────────────────────────────────────────

describe('isValidSlackWebhookUrl', () => {
  describe('valid URLs', () => {
    it('accepts a well-formed hooks.slack.com URL', () => {
      expect(
        isValidSlackWebhookUrl('https://hooks.slack.com/services/T123/B456/abc123xyz'),
      ).toBe(true)
    })

    it('accepts hooks-regional.slack.com (Slack Enterprise)', () => {
      expect(
        isValidSlackWebhookUrl('https://hooks-regional.slack.com/services/T123/B456/abc'),
      ).toBe(true)
    })
  })

  describe('SSRF / security rejections', () => {
    it('rejects http (not https)', () => {
      expect(
        isValidSlackWebhookUrl('http://hooks.slack.com/services/T123/B456/abc'),
      ).toBe(false)
    })

    it('rejects a completely different host', () => {
      expect(isValidSlackWebhookUrl('https://evil.example.com/payload')).toBe(false)
    })

    it('rejects localhost', () => {
      expect(isValidSlackWebhookUrl('https://localhost/services/T/B/x')).toBe(false)
    })

    it('rejects a look-alike domain (slack.com.evil.com)', () => {
      expect(
        isValidSlackWebhookUrl('https://slack.com.evil.com/services/T/B/x'),
      ).toBe(false)
    })

    it('rejects a URL whose path does not start with /services/', () => {
      expect(
        isValidSlackWebhookUrl('https://hooks.slack.com/webhooks/T123/B456'),
      ).toBe(false)
    })

    it('rejects an empty string', () => {
      expect(isValidSlackWebhookUrl('')).toBe(false)
    })

    it('rejects a non-URL string', () => {
      expect(isValidSlackWebhookUrl('not a url at all')).toBe(false)
    })
  })
})

// ─── sendSlack ─────────────────────────────────────────────────────────────────

const VALID_WEBHOOK = 'https://hooks.slack.com/services/T123/B456/validtoken'
const VALID_MESSAGE = { text: 'Site down alert' }

describe('sendSlack', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns sent:true when Slack responds 200', async () => {
    fetchSpy.mockResolvedValue({ ok: true })

    const result = await sendSlack(VALID_WEBHOOK, VALID_MESSAGE)

    expect(result.sent).toBe(true)
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it('posts JSON to the webhook URL', async () => {
    fetchSpy.mockResolvedValue({ ok: true })

    await sendSlack(VALID_WEBHOOK, VALID_MESSAGE)

    const [url, opts] = fetchSpy.mock.calls[0]!
    expect(url).toBe(VALID_WEBHOOK)
    expect(opts.method).toBe('POST')
    expect(opts.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(opts.body)).toMatchObject({ text: 'Site down alert' })
  })

  it('returns sent:false when Slack responds with 4xx', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'invalid_token',
    })

    const result = await sendSlack(VALID_WEBHOOK, VALID_MESSAGE)

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('403')
  })

  it('returns sent:false for an invalid webhook URL (SSRF guard)', async () => {
    const result = await sendSlack('https://evil.example.com/hook', VALID_MESSAGE)

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('disallowed')
    // Never reaches the network
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns sent:false for an invalid message shape', async () => {
    // text must be a non-empty string, not a number
    const result = await sendSlack(VALID_WEBHOOK, { text: '' })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('Invalid Slack message shape')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns sent:false on a network error (never throws)', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await sendSlack(VALID_WEBHOOK, VALID_MESSAGE)

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('ECONNREFUSED')
  })

  it('returns sent:false on a timeout (never throws)', async () => {
    const timeoutErr = new Error('The operation was aborted')
    timeoutErr.name = 'TimeoutError'
    fetchSpy.mockRejectedValue(timeoutErr)

    const result = await sendSlack(VALID_WEBHOOK, VALID_MESSAGE)

    expect(result.sent).toBe(false)
    expect(result.reason).toMatch(/timed out/i)
  })

  it('accepts a message with valid blocks', async () => {
    fetchSpy.mockResolvedValue({ ok: true })

    const result = await sendSlack(VALID_WEBHOOK, {
      text: 'Alert',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: 'Header' } },
        { type: 'section', text: { type: 'mrkdwn', text: '_body_' } },
      ],
    })

    expect(result.sent).toBe(true)
  })

  it('rejects a message with too many blocks (>50)', async () => {
    const blocks = Array.from({ length: 51 }, () => ({ type: 'divider' as const }))
    const result = await sendSlack(VALID_WEBHOOK, { text: 'x', blocks })

    expect(result.sent).toBe(false)
    expect(result.reason).toBe('Invalid Slack message shape')
  })
})
