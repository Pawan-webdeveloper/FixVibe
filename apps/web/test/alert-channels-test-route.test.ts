/**
 * apps/web/test/alert-channels-test-route.test.ts
 *
 * Tests for POST /api/projects/:id/alert-channels/test
 *
 * The test send is the user's last line of defense against a typo'd webhook
 * URL: a clean schema can pass validation but the request still 404s at
 * Discord. This route has to:
 *   1. Authorize correctly — anon → 401, wrong project → 404, wrong
 *      channel-for-project → 404
 *   2. Dispatch to the right sender per channel type (slack, discord, webhook)
 *   3. Return a structured result that the UI can render inline
 *   4. Never expose the URL or the secret in the response
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockViewer,
  mockGetAlertChannel,
  mockSendTestSlack,
  mockSendTestDiscord,
  mockSendTestWebhook,
} = vi.hoisted(() => ({
  mockViewer: vi.fn(),
  mockGetAlertChannel: vi.fn(),
  mockSendTestSlack: vi.fn(),
  mockSendTestDiscord: vi.fn(),
  mockSendTestWebhook: vi.fn(),
}))

vi.mock('@/lib/authz.ts', () => ({
  getViewer: () => mockViewer(),
}))

vi.mock('@scanlyfix/db', () => ({
  getAlertChannel: (...args: unknown[]) => mockGetAlertChannel(...args),
}))

vi.mock('@/lib/test-alert.ts', () => ({
  sendTestSlack: (...args: unknown[]) => mockSendTestSlack(...args),
  sendTestDiscord: (...args: unknown[]) => mockSendTestDiscord(...args),
  sendTestWebhook: (...args: unknown[]) => mockSendTestWebhook(...args),
}))

const { POST } = await import('../app/api/projects/[id]/alert-channels/test/route.ts')

const USER = { kind: 'user', userId: 'usr-1', email: 'test@example.com' }
const ANON = { kind: 'anonymous' }
const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000'
const CHANNEL_ID = '660e8400-e29b-41d4-a716-446655440001'

function post(body: unknown) {
  return new Request(`http://app.test/api/projects/${PROJECT_ID}/alert-channels/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function ctx() {
  return { params: Promise.resolve({ id: PROJECT_ID }) }
}

beforeEach(() => {
  mockViewer.mockReset()
  mockGetAlertChannel.mockReset()
  mockSendTestSlack.mockReset()
  mockSendTestDiscord.mockReset()
  mockSendTestWebhook.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/projects/:id/alert-channels/test', () => {
  it('returns 401 for anonymous viewer', async () => {
    mockViewer.mockResolvedValue(ANON)
    const res = await POST(post({ channelId: CHANNEL_ID }), ctx())
    expect(res.status).toBe(401)
    // The auth check must run before any DB lookup
    expect(mockGetAlertChannel).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON', async () => {
    mockViewer.mockResolvedValue(USER)
    const req = new Request(
      `http://app.test/api/projects/${PROJECT_ID}/alert-channels/test`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      },
    )
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Invalid JSON body')
  })

  it('returns 400 when channelId is missing', async () => {
    mockViewer.mockResolvedValue(USER)
    const res = await POST(post({}), ctx())
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBeDefined()
  })

  it('returns 400 when channelId is not a UUID', async () => {
    mockViewer.mockResolvedValue(USER)
    const res = await POST(post({ channelId: 'not-a-uuid' }), ctx())
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/UUID/i)
  })

  it('returns 404 when channel does not exist for the project', async () => {
    mockViewer.mockResolvedValue(USER)
    mockGetAlertChannel.mockResolvedValue(null)

    const res = await POST(post({ channelId: CHANNEL_ID }), ctx())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Channel not found' })
    // Auth helpers must run with the URL's project id, so a channel from a
    // different project cannot be tested via this URL.
    expect(mockGetAlertChannel).toHaveBeenCalledWith(
      CHANNEL_ID,
      USER,
      PROJECT_ID,
    )
  })

  describe('Slack channel', () => {
    const slackChannel = {
      id: CHANNEL_ID,
      projectId: PROJECT_ID,
      channel: 'slack' as const,
      enabled: true,
      config: { webhookUrl: 'https://hooks.slack.com/services/T/B/secret-token' },
    }

    it('sends a test message and returns sent:true on success', async () => {
      mockViewer.mockResolvedValue(USER)
      mockGetAlertChannel.mockResolvedValue(slackChannel)
      mockSendTestSlack.mockResolvedValue({ sent: true })

      const res = await POST(post({ channelId: CHANNEL_ID }), ctx())
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ sent: true })
      expect(mockSendTestSlack).toHaveBeenCalledWith(slackChannel.config)
    })

    it('returns sent:false with the upstream reason on failure', async () => {
      mockViewer.mockResolvedValue(USER)
      mockGetAlertChannel.mockResolvedValue(slackChannel)
      mockSendTestSlack.mockResolvedValue({
        sent: false,
        reason: 'Slack returned 404: not_found',
      })

      const res = await POST(post({ channelId: CHANNEL_ID }), ctx())
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        sent: false,
        reason: 'Slack returned 404: not_found',
      })
    })

    it('does NOT include the webhook URL in the response', async () => {
      mockViewer.mockResolvedValue(USER)
      mockGetAlertChannel.mockResolvedValue(slackChannel)
      mockSendTestSlack.mockResolvedValue({
        sent: false,
        reason: 'Some upstream error',
      })

      const res = await POST(post({ channelId: CHANNEL_ID }), ctx())
      const body = await res.json()
      const serialized = JSON.stringify(body)
      expect(serialized).not.toContain('hooks.slack.com')
      expect(serialized).not.toContain('secret-token')
    })
  })

  describe('Discord channel', () => {
    const discordChannel = {
      id: CHANNEL_ID,
      projectId: PROJECT_ID,
      channel: 'discord' as const,
      enabled: true,
      config: { webhookUrl: 'https://discord.com/api/webhooks/123/secret-token' },
    }

    it('sends a test message via the Discord sender', async () => {
      mockViewer.mockResolvedValue(USER)
      mockGetAlertChannel.mockResolvedValue(discordChannel)
      mockSendTestDiscord.mockResolvedValue({ sent: true })

      const res = await POST(post({ channelId: CHANNEL_ID }), ctx())
      expect(res.status).toBe(200)
      expect(mockSendTestDiscord).toHaveBeenCalledWith(discordChannel.config)
    })

    it('does NOT include the webhook URL in any failure response', async () => {
      mockViewer.mockResolvedValue(USER)
      mockGetAlertChannel.mockResolvedValue(discordChannel)
      mockSendTestDiscord.mockResolvedValue({
        sent: false,
        reason: 'Discord returned 401',
      })

      const res = await POST(post({ channelId: CHANNEL_ID }), ctx())
      const body = await res.json()
      expect(JSON.stringify(body)).not.toContain('discord.com')
      expect(JSON.stringify(body)).not.toContain('secret-token')
    })
  })

  describe('generic webhook channel', () => {
    const webhookChannel = {
      id: CHANNEL_ID,
      projectId: PROJECT_ID,
      channel: 'webhook' as const,
      enabled: true,
      config: {
        url: 'https://webhook.site/secret-token',
        secret: 'super-secret-shared',
      },
    }

    it('sends a test message via the webhook sender', async () => {
      mockViewer.mockResolvedValue(USER)
      mockGetAlertChannel.mockResolvedValue(webhookChannel)
      mockSendTestWebhook.mockResolvedValue({ sent: true })

      const res = await POST(post({ channelId: CHANNEL_ID }), ctx())
      expect(res.status).toBe(200)
      expect(mockSendTestWebhook).toHaveBeenCalledWith(webhookChannel.config)
    })

    it('does NOT leak URL or secret in the response', async () => {
      mockViewer.mockResolvedValue(USER)
      mockGetAlertChannel.mockResolvedValue(webhookChannel)
      mockSendTestWebhook.mockResolvedValue({
        sent: false,
        reason: 'Webhook endpoint returned 500',
      })

      const res = await POST(post({ channelId: CHANNEL_ID }), ctx())
      const body = await res.json()
      const serialized = JSON.stringify(body)
      expect(serialized).not.toContain('webhook.site')
      expect(serialized).not.toContain('secret-token')
      expect(serialized).not.toContain('super-secret-shared')
    })
  })

  describe('email channel', () => {
    it('returns 400 because test-send is a different surface', async () => {
      mockViewer.mockResolvedValue(USER)
      mockGetAlertChannel.mockResolvedValue({
        id: CHANNEL_ID,
        projectId: PROJECT_ID,
        channel: 'email' as const,
        enabled: true,
        config: { email: 'owner@example.com' },
      })

      const res = await POST(post({ channelId: CHANNEL_ID }), ctx())
      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toMatch(/email/i)
    })
  })
})
