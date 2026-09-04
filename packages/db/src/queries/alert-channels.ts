/**
 * packages/db/src/queries/alert-channels.ts
 *
 * Alert channels ke liye all DB operations.
 *
 * Two versions of getAlertChannels:
 *  1. Internal (no viewer) → full config for deliverAlert (needs real webhook URL)
 *  2. External (with viewer) → masked config for API responses (security)
 *
 * WHY mask webhook URL in API responses:
 *  Webhook URL = secret. Agar koi API response intercept kare toh
 *  unhein full URL nahi milni chahiye. Last 6 chars dikhao — enough to identify.
 */

import { db } from '../client.ts'
import { alertChannels, projects } from '../schema.ts'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import type { Viewer } from './viewer.ts'

// ─── Channel Type Union ────────────────────────────────────────────────────────
// Single source of truth for channel values — matches the pgEnum in schema.ts
// and is used by the discriminated public type below.
export const CHANNEL_VALUES = ['slack', 'email', 'webhook', 'discord'] as const
export type AlertChannelName = (typeof CHANNEL_VALUES)[number]

// ─── Config Schemas ────────────────────────────────────────────────────────────
// WHY per-channel Zod schemas (not generic Record<string,unknown>):
// Each channel has specific required fields — validate at insert, not at use time
//
// SSRF validation is intentionally minimal here — assertSafeUrl is the source of
// truth at send time, and this schema is only catching malformed input.

export const SlackChannelConfigSchema = z.object({
  webhookUrl: z
    .string()
    .url()
    .refine((url) => url.startsWith('https://hooks.slack.com/services/'), {
      message: 'Must be a valid Slack incoming webhook URL',
    }),
})

export type SlackChannelConfig = z.infer<typeof SlackChannelConfigSchema>

export const DiscordChannelConfigSchema = z.object({
  // Discord uses two host families (discord.com + legacy discordapp.com) and
  // a fixed path. Pin it here so a tampered DB row still gets caught at the
  // boundary.
  webhookUrl: z
    .string()
    .url()
    .refine(
      (url) =>
        /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+/.test(
          url,
        ),
      { message: 'Must be a valid Discord incoming webhook URL' },
    ),
})

export type DiscordChannelConfig = z.infer<typeof DiscordChannelConfigSchema>

export const WebhookChannelConfigSchema = z.object({
  // HTTPS only — SSRF validation runs again at send time via safeFetch
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), {
      message: 'Webhook URL must use https',
    })
    .refine((u) => {
      // WHATWG URL parses user:pass@host — we do not allow it.
      try {
        const parsed = new URL(u)
        return parsed.username === '' && parsed.password === ''
      } catch {
        return false
      }
    }, { message: 'Webhook URL must not contain embedded credentials' }),
  // Optional shared secret — when present, sender computes HMAC-SHA256 and
  // sets X-Webhook-Secret header. Bounded length to prevent abuse.
  secret: z.string().min(8).max(256).optional(),
})

export type WebhookChannelConfig = z.infer<typeof WebhookChannelConfigSchema>

// ─── Output Types ──────────────────────────────────────────────────────────────

// Internal — full config (used by deliverAlert only, never sent to client)
export interface AlertChannelInternal {
  id: string
  projectId: string
  channel: AlertChannelName
  config: Record<string, unknown>
  enabled: boolean
}

// External — masked config (safe to return from API)
export interface AlertChannelPublic {
  id: string
  projectId: string
  channel: AlertChannelName
  maskedConfig: Record<string, string>
  enabled: boolean
  createdAt: string
}

// ─── Mask Helper ───────────────────────────────────────────────────────────────
function maskConfig(
  channel: string,
  config: Record<string, unknown>,
): Record<string, string> {
  if (channel === 'slack') {
    const url = config.webhookUrl as string | undefined
    // WHY show last 6 chars: enough to confirm which webhook, not enough to use
    return {
      webhookUrl: url
        ? `https://hooks.slack.com/services/***${url.slice(-6)}`
        : '',
    }
  }
  if (channel === 'discord') {
    const url = config.webhookUrl as string | undefined
    // Same pattern as Slack: show only the trailing token fragment.
    return {
      webhookUrl: url ? `https://discord.com/api/webhooks/***/${url.slice(-6)}` : '',
    }
  }
  if (channel === 'webhook') {
    const url = config.url as string | undefined
    const hasSecret = typeof config.secret === 'string' && config.secret.length > 0
    // WHY mask differently from slack: arbitrary URL, not a fixed prefix
    // Show only the host so the user can confirm the target without exposing
    // the full path/secret.
    let host = ''
    if (url) {
      try {
        host = new URL(url).host
      } catch {
        host = '***'
      }
    }
    return {
      url: url ? `https://${host}/***` : '',
      // WHY never indicate whether secret is set: avoid leaking config state
      secret: hasSecret ? '***' : '',
    }
  }
  return {}
}

// ─── Authorization ─────────────────────────────────────────────────────────────
async function assertProjectOwnership(
  projectId: string,
  viewer: Viewer,
): Promise<boolean> {
  if (viewer.kind !== 'user') return false
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { id: true, ownerId: true },
  })
  return project?.ownerId === viewer.userId
}

// ─── getAlertChannels ──────────────────────────────────────────────────────────
// Overload 1: Internal (no viewer) — full config for deliverAlert
export async function getAlertChannels(
  projectId: string,
): Promise<AlertChannelInternal[]>

// Overload 2: External (with viewer) — masked config for API
export async function getAlertChannels(
  projectId: string,
  viewer: Viewer,
): Promise<AlertChannelPublic[]>

export async function getAlertChannels(
  projectId: string,
  viewer?: Viewer,
): Promise<AlertChannelInternal[] | AlertChannelPublic[]> {
  if (viewer) {
    const owns = await assertProjectOwnership(projectId, viewer)
    if (!owns) return []
  }

  const rows = await db.query.alertChannels.findMany({
    where: eq(alertChannels.projectId, projectId),
    orderBy: alertChannels.createdAt,
  })

  if (!viewer) {
    // Internal use — return full config
    return rows.map((r): AlertChannelInternal => ({
      id: r.id,
      projectId: r.projectId,
      channel: r.channel as AlertChannelName,
      config: r.config as Record<string, unknown>,
      enabled: r.enabled,
    }))
  }

  // External use — mask sensitive values
  return rows.map((r): AlertChannelPublic => ({
    id: r.id,
    projectId: r.projectId,
    channel: r.channel as AlertChannelName,
    maskedConfig: maskConfig(r.channel, r.config as Record<string, unknown>),
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
  }))
}

// ─── getAlertChannel (single, internal) ────────────────────────────────────────
// One row by id, with ownership check baked in. Returns the full row (raw
// config) because the only caller is the test-send route, which needs the
// unmasked URL. Anywhere else a single channel is read for the API surface,
// it should use getAlertChannels(projectId, viewer) and pick the row.
//
// WHY an optional `expectedProjectId`: a route scoped to /projects/:id can
// pass its URL's project id and get a 404-equivalent when the named channel
// belongs to a different project — even if the caller owns both. Without
// this, a request body could fish for channel ids across the caller's own
// projects. That is still within the caller's reach, but it lets us return
// the right "not in this project" answer instead of "not in any project".
export async function getAlertChannel(
  channelId: string,
  viewer: Viewer,
  expectedProjectId?: string,
): Promise<AlertChannelInternal | null> {
  if (viewer.kind !== 'user') return null
  const row = await db.query.alertChannels.findFirst({
    where: eq(alertChannels.id, channelId),
  })
  if (!row) return null
  if (expectedProjectId && row.projectId !== expectedProjectId) return null
  // WHY check ownership via the project, not the channel: the channel row
  // does not carry ownerId, and adding it would be denormalised. The project
  // already has the canonical owner.
  const owns = await assertProjectOwnership(row.projectId, viewer)
  if (!owns) return null
  return {
    id: row.id,
    projectId: row.projectId,
    channel: row.channel as AlertChannelName,
    config: row.config as Record<string, unknown>,
    enabled: row.enabled,
  }
}

// ─── upsertAlertChannel ────────────────────────────────────────────────────────
/**
 * WHY upsert (not insert):
 * Ek project mein ek hi channel per type honi chahiye.
 * Duplicate webhooks = duplicate alerts.
 */
export async function upsertAlertChannel(
  projectId: string,
  channel: AlertChannelName,
  config: Record<string, unknown>,
  viewer: Viewer,
): Promise<{ ok: boolean; reason?: string }> {
  const owns = await assertProjectOwnership(projectId, viewer)
  if (!owns) return { ok: false, reason: 'Not authorized' }

  // Validate config per channel type
  if (channel === 'slack') {
    const parsed = SlackChannelConfigSchema.safeParse(config)
    if (!parsed.success) {
      return {
        ok: false,
        reason: parsed.error.issues[0]?.message ?? 'Invalid Slack config',
      }
    }
  }

  if (channel === 'discord') {
    const parsed = DiscordChannelConfigSchema.safeParse(config)
    if (!parsed.success) {
      return {
        ok: false,
        reason: parsed.error.issues[0]?.message ?? 'Invalid Discord config',
      }
    }
  }

  if (channel === 'webhook') {
    const parsed = WebhookChannelConfigSchema.safeParse(config)
    if (!parsed.success) {
      return {
        ok: false,
        reason: parsed.error.issues[0]?.message ?? 'Invalid webhook config',
      }
    }
  }

  // Check if already exists
  const existing = await db.query.alertChannels.findFirst({
    where: and(
      eq(alertChannels.projectId, projectId),
      eq(alertChannels.channel, channel),
    ),
    columns: { id: true },
  })

  if (existing) {
    await db
      .update(alertChannels)
      .set({ config, enabled: true })
      .where(eq(alertChannels.id, existing.id))
  } else {
    await db.insert(alertChannels).values({
      projectId,
      channel,
      config,
      enabled: true,
    })
  }

  return { ok: true }
}

// ─── setAlertChannelEnabled ────────────────────────────────────────────────────
export async function setAlertChannelEnabled(
  channelId: string,
  enabled: boolean,
  viewer: Viewer,
): Promise<{ ok: boolean; reason?: string }> {
  const row = await db.query.alertChannels.findFirst({
    where: eq(alertChannels.id, channelId),
    columns: { id: true, projectId: true },
  })
  if (!row) return { ok: false, reason: 'Channel not found' }

  const owns = await assertProjectOwnership(row.projectId, viewer)
  if (!owns) return { ok: false, reason: 'Not authorized' }

  await db
    .update(alertChannels)
    .set({ enabled })
    .where(eq(alertChannels.id, channelId))

  return { ok: true }
}

// ─── deleteAlertChannel ────────────────────────────────────────────────────────
export async function deleteAlertChannel(
  channelId: string,
  viewer: Viewer,
): Promise<{ ok: boolean; reason?: string }> {
  const row = await db.query.alertChannels.findFirst({
    where: eq(alertChannels.id, channelId),
    columns: { id: true, projectId: true },
  })
  if (!row) return { ok: false, reason: 'Channel not found' }

  const owns = await assertProjectOwnership(row.projectId, viewer)
  if (!owns) return { ok: false, reason: 'Not authorized' }

  await db.delete(alertChannels).where(eq(alertChannels.id, channelId))
  return { ok: true }
}
