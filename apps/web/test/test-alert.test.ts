/**
 * apps/web/test/test-alert.test.ts
 *
 * Unit tests for the per-channel test senders. These are thin wrappers over
 * the production senders — the value to test is that the wrapper:
 *   1. Pulls the URL out of whatever shape the stored config has
 *   2. Returns a safe { sent, reason } for any malformed config
 *   3. Produces a message that is recognisably a test (so a human reading
 *      Slack later does not page on it)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendSlack = vi.fn()
const sendDiscord = vi.fn()
const sendWebhook = vi.fn()
const buildWebhookPayload = vi.fn()

vi.mock('../lib/slack.ts', () => ({ sendSlack }))
vi.mock('../lib/discord.ts', () => ({ sendDiscord, renderDiscord: () => ({ content: 'x', embeds: [] }) }))
vi.mock('../lib/webhook.ts', () => ({ sendWebhook, buildWebhookPayload }))

const { sendTestSlack, sendTestDiscord, sendTestWebhook } =
  await import('../lib/test-alert.ts')

beforeEach(() => {
  sendSlack.mockReset()
  sendDiscord.mockReset()
  sendWebhook.mockReset()
  buildWebhookPayload.mockReset()
  sendSlack.mockResolvedValue({ sent: true })
  sendDiscord.mockResolvedValue({ sent: true })
  sendWebhook.mockResolvedValue({ sent: true })
  buildWebhookPayload.mockReturnValue({
    kind: 'test_alert',
    projectName: 'ScanlyFix',
    monitorType: 'uptime',
    url: 'https://app.test',
    payload: {},
    timestamp: '2026-01-01T00:00:00.000Z',
    severity: 'info',
  })
})

afterEach(() => vi.restoreAllMocks())

describe('sendTestSlack', () => {
  it('rejects a non-object config', async () => {
    const r = await sendTestSlack('https://hooks.slack.com/services/T/B/x')
    expect(r).toEqual({ sent: false, reason: 'Invalid Slack channel config' })
    expect(sendSlack).not.toHaveBeenCalled()
  })

  it('rejects a config without webhookUrl', async () => {
    const r = await sendTestSlack({})
    expect(r).toEqual({ sent: false, reason: 'Invalid Slack channel config' })
    expect(sendSlack).not.toHaveBeenCalled()
  })

  it('passes the URL through to sendSlack', async () => {
    sendSlack.mockResolvedValue({ sent: true })
    const url = 'https://hooks.slack.com/services/T/B/secret'
    const r = await sendTestSlack({ webhookUrl: url })
    expect(r.sent).toBe(true)
    expect(sendSlack).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ text: expect.stringMatching(/Test alert/) }),
    )
  })
})

describe('sendTestDiscord', () => {
  it('rejects a non-object config', async () => {
    const r = await sendTestDiscord(null)
    expect(r).toEqual({ sent: false, reason: 'Invalid Discord channel config' })
    expect(sendDiscord).not.toHaveBeenCalled()
  })

  it('rejects a config without webhookUrl', async () => {
    const r = await sendTestDiscord({})
    expect(r).toEqual({ sent: false, reason: 'Invalid Discord channel config' })
    expect(sendDiscord).not.toHaveBeenCalled()
  })

  it('passes the URL through to sendDiscord', async () => {
    sendDiscord.mockResolvedValue({ sent: true })
    const url = 'https://discord.com/api/webhooks/1/secret'
    const r = await sendTestDiscord({ webhookUrl: url })
    expect(r.sent).toBe(true)
    expect(sendDiscord).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ embeds: expect.any(Array) }),
    )
  })
})

describe('sendTestWebhook', () => {
  it('rejects a non-object config', async () => {
    const r = await sendTestWebhook(undefined)
    expect(r).toEqual({ sent: false, reason: 'Invalid webhook channel config' })
    expect(sendWebhook).not.toHaveBeenCalled()
  })

  it('rejects http URLs', async () => {
    const r = await sendTestWebhook({ url: 'http://webhook.site/abc' })
    expect(r).toEqual({ sent: false, reason: 'Invalid webhook URL' })
    expect(sendWebhook).not.toHaveBeenCalled()
  })

  it('passes https URL and secret through to sendWebhook', async () => {
    sendWebhook.mockResolvedValue({ sent: true })
    const r = await sendTestWebhook({
      url: 'https://webhook.site/abc',
      secret: 'shared-secret',
    })
    expect(r.sent).toBe(true)
    expect(sendWebhook).toHaveBeenCalledWith(
      { url: 'https://webhook.site/abc', secret: 'shared-secret' },
      expect.objectContaining({ kind: 'test_alert', severity: 'info' }),
    )
  })

  it('omits the secret when none is configured', async () => {
    sendWebhook.mockResolvedValue({ sent: true })
    await sendTestWebhook({ url: 'https://webhook.site/abc' })
    expect(sendWebhook).toHaveBeenCalledWith(
      { url: 'https://webhook.site/abc', secret: undefined },
      expect.any(Object),
    )
  })
})
