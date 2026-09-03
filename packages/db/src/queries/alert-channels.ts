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

// ─── Config Schemas ────────────────────────────────────────────────────────────
// WHY per-channel Zod schemas (not generic Record<string,unknown>):
// Each channel has specific required fields — validate at insert, not at use time

export const SlackChannelConfigSchema = z.object({
  webhookUrl: z
    .string()
    .url()
    .refine((url) => url.startsWith('https://hooks.slack.com/services/'), {
      message: 'Must be a valid Slack incoming webhook URL',
    }),
})

export type SlackChannelConfig = z.infer<typeof SlackChannelConfigSchema>

// ─── Output Types ──────────────────────────────────────────────────────────────

// Internal — full config (used by deliverAlert only, never sent to client)
export interface AlertChannelInternal {
  id: string
  channel: string
  config: Record<string, unknown>
  enabled: boolean
}

// External — masked config (safe to return from API)
export interface AlertChannelPublic {
  id: string
  projectId: string
  channel: 'slack' | 'email'
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
      channel: r.channel,
      config: r.config as Record<string, unknown>,
      enabled: r.enabled,
    }))
  }

  // External use — mask sensitive values
  return rows.map((r): AlertChannelPublic => ({
    id: r.id,
    projectId: r.projectId,
    channel: r.channel as 'slack' | 'email',
    maskedConfig: maskConfig(r.channel, r.config as Record<string, unknown>),
    enabled: r.enabled,
    createdAt: r.createdAt.toISOString(),
  }))
}

// ─── upsertAlertChannel ────────────────────────────────────────────────────────
/**
 * WHY upsert (not insert):
 * Ek project mein ek hi Slack channel honi chahiye.
 * Duplicate webhooks = duplicate alerts.
 */
export async function upsertAlertChannel(
  projectId: string,
  channel: 'slack' | 'email',
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