/**
 * packages/db/test/alert-channels-schema.test.ts
 *
 * Pure unit tests for the per-channel Zod schemas in alert-channels.ts.
 * No database — we only need to know that the schemas reject bad input
 * and accept good input, so the rest of the system can trust them.
 */

import { describe, expect, it } from 'vitest'
import {
  SlackChannelConfigSchema,
  DiscordChannelConfigSchema,
  WebhookChannelConfigSchema,
} from '../src/queries/alert-channels.ts'

describe('SlackChannelConfigSchema', () => {
  it('accepts a Slack incoming-webhook URL', () => {
    const result = SlackChannelConfigSchema.safeParse({
      webhookUrl: 'https://hooks.slack.com/services/T0/B0/xxx',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-Slack URL even if it is https', () => {
    const result = SlackChannelConfigSchema.safeParse({
      webhookUrl: 'https://example.com/hook',
    })
    expect(result.success).toBe(false)
  })

  it('rejects http', () => {
    const result = SlackChannelConfigSchema.safeParse({
      webhookUrl: 'http://hooks.slack.com/services/T0/B0/xxx',
    })
    expect(result.success).toBe(false)
  })
})

describe('DiscordChannelConfigSchema', () => {
  it('accepts a Discord incoming-webhook URL', () => {
    const result = DiscordChannelConfigSchema.safeParse({
      webhookUrl: 'https://discord.com/api/webhooks/1234567890/abcdefghij_token',
    })
    expect(result.success).toBe(true)
  })

  it('accepts the legacy discordapp.com host', () => {
    const result = DiscordChannelConfigSchema.safeParse({
      webhookUrl: 'https://discordapp.com/api/webhooks/1234567890/abcdefghij_token',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-Discord host', () => {
    const result = DiscordChannelConfigSchema.safeParse({
      webhookUrl: 'https://example.com/api/webhooks/123/abc',
    })
    expect(result.success).toBe(false)
  })

  it('rejects http', () => {
    const result = DiscordChannelConfigSchema.safeParse({
      webhookUrl: 'http://discord.com/api/webhooks/123/abc',
    })
    expect(result.success).toBe(false)
  })

  it('rejects the wrong path', () => {
    const result = DiscordChannelConfigSchema.safeParse({
      webhookUrl: 'https://discord.com/foo/123/abc',
    })
    expect(result.success).toBe(false)
  })

  it('rejects malformed strings', () => {
    const result = DiscordChannelConfigSchema.safeParse({
      webhookUrl: 'not a url',
    })
    expect(result.success).toBe(false)
  })
})

describe('WebhookChannelConfigSchema', () => {
  it('accepts a valid https URL with no secret', () => {
    const result = WebhookChannelConfigSchema.safeParse({
      url: 'https://webhook.site/abc-123',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid https URL with a secret', () => {
    const result = WebhookChannelConfigSchema.safeParse({
      url: 'https://webhook.site/abc-123',
      secret: 'a-shared-secret-value',
    })
    expect(result.success).toBe(true)
  })

  it('rejects http URLs (https only)', () => {
    const result = WebhookChannelConfigSchema.safeParse({
      url: 'http://webhook.site/abc-123',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/https/i)
    }
  })

  it('rejects non-URL strings', () => {
    const result = WebhookChannelConfigSchema.safeParse({ url: 'not a url' })
    expect(result.success).toBe(false)
  })

  it('rejects URLs with embedded credentials', () => {
    const result = WebhookChannelConfigSchema.safeParse({
      url: 'https://user:pass@webhook.site/hook',
    })
    // zod's z.string().url() rejects this, so the parse fails outright
    expect(result.success).toBe(false)
  })

  it('rejects too-short secrets (< 8 chars)', () => {
    const result = WebhookChannelConfigSchema.safeParse({
      url: 'https://webhook.site/abc',
      secret: 'short',
    })
    expect(result.success).toBe(false)
  })

  it('rejects too-long secrets (> 256 chars)', () => {
    const result = WebhookChannelConfigSchema.safeParse({
      url: 'https://webhook.site/abc',
      secret: 'x'.repeat(257),
    })
    expect(result.success).toBe(false)
  })

  it('rejects non-string secret', () => {
    const result = WebhookChannelConfigSchema.safeParse({
      url: 'https://webhook.site/abc',
      secret: 12345,
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing url', () => {
    const result = WebhookChannelConfigSchema.safeParse({ secret: 'a-shared-secret' })
    expect(result.success).toBe(false)
  })
})
