/**
 * apps/web/lib/discord.ts
 *
 * Discord incoming webhook sender.
 *
 * Modeled on the Slack module: the URL is a secret that we validate against
 * a fixed host allowlist (Discord's webhook host), the body is platform-
 * specific (Discord "embeds"), and we never log the URL.
 *
 * WHY a dedicated module (not just another webhook variant):
 *   - Discord's body shape is rich: embeds with color, fields, footer, etc.
 *     The generic webhook channel's "stable JSON" is the wire contract for
 *     generic receivers; Discord receivers want Discord embeds.
 *   - Severity → color mapping belongs here, not in the alert-email pipeline.
 *   - The URL allowlist is a fixed prefix, so the SSRF surface collapses to
 *     "is this discord.com?" — same shape as Slack.
 *
 * Why incoming webhook (not Bot API):
 *   - No OAuth, no bot token
 *   - User pastes a URL, that's it
 *   - One-way delivery is enough for alerts
 *
 * Security:
 *   - `server-only` — never bundled to the client
 *   - URL allowlist: discord.com / discordapp.com only
 *   - URL is never logged
 *   - 10s timeout
 *   - Zod-validated payload before send
 */

import 'server-only'
import { z } from 'zod'

// ─── Embed colors (decimal RGB) ────────────────────────────────────────────────
// Discord embed colors are 24-bit integers, NOT hex. These are the canonical
// "alert" palette so a red embed is unmistakably critical at a glance.
const COLOR_CRITICAL = 0xdc_35_45 //  red   — site down / TLS expired
const COLOR_WARNING = 0xfb_a_61_8 //  amber — reminders, score drops
const COLOR_OK = 0x57_f2_87 //  green — recovery
const COLOR_INFO = 0x58_6_5_f2 //  blue  — default / unknown

export type EmbedColor = 'critical' | 'warning' | 'ok' | 'info'

function colorFor(kind: string): { color: number; emoji: string } {
  // Mirror the severity mapping in webhook.ts so the two channels agree on
  // what "critical" means. Keep in sync when one moves.
  if (
    kind === 'downtime' ||
    kind === 'tls_expiring' ||
    kind === 'domain_expiring' ||
    kind.startsWith('certificate-expiry') ||
    kind.startsWith('domain-expiry')
  ) {
    return { color: COLOR_CRITICAL, emoji: '🔴' }
  }
  if (kind === 'recovered') {
    return { color: COLOR_OK, emoji: '🟢' }
  }
  if (
    kind === 'downtime-reminder' ||
    kind === 'web_vitals' ||
    kind === 'score-drop' ||
    kind === 'dns_drift'
  ) {
    return { color: COLOR_WARNING, emoji: '🟡' }
  }
  return { color: COLOR_INFO, emoji: '🔵' }
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The subset of the Discord embed spec we actually use. Kept narrow on
 * purpose: a wider schema means more to validate, and we have no need for
 * images, thumbnails, authors, or providers in an alert.
 */
export const DiscordEmbedSchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().min(1).max(4096),
  color: z.number().int().min(0).max(0xffffff),
  // Field for the project name + the affected URL. Discord caps fields at 25
  // — we never get close, but the cap is in the schema.
  fields: z
    .array(
      z.object({
        name: z.string().min(1).max(256),
        value: z.string().min(1).max(1024),
        inline: z.boolean().optional(),
      }),
    )
    .max(25)
    .optional(),
  footer: z
    .object({ text: z.string().min(1).max(2048) })
    .optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
})

export const DiscordMessageSchema = z.object({
  // content is the fallback for clients that do not render embeds. Required
  // by Discord; we keep it under the 2000 char cap.
  content: z.string().min(1).max(2000),
  // Username override so the alert appears from "ScanlyFix" not the webhook
  // default. Optional — Discord will use the webhook's default if omitted.
  username: z.string().min(1).max(80).optional(),
  embeds: z.array(DiscordEmbedSchema).max(10).optional(),
})

export type DiscordEmbed = z.infer<typeof DiscordEmbedSchema>
export type DiscordMessage = z.infer<typeof DiscordMessageSchema>

export interface DiscordSendResult {
  sent: boolean
  reason?: string
}

// ─── URL validator ────────────────────────────────────────────────────────────
// Discord uses two host families: discord.com (current) and discordapp.com
// (legacy, still active). Both are needed.
const ALLOWED_DISCORD_HOSTS = new Set([
  'discord.com',
  'discordapp.com',
])

export function isValidDiscordWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (!ALLOWED_DISCORD_HOSTS.has(parsed.hostname)) return false
    if (parsed.username !== '' || parsed.password !== '') return false
    // Discord webhook path is always /api/webhooks/{id}/{token}
    if (!parsed.pathname.startsWith('/api/webhooks/')) return false
    // Sanity check the trailing segments
    const parts = parsed.pathname.split('/').filter(Boolean)
    // [api, webhooks, id, token]
    if (parts.length < 4) return false
    return true
  } catch {
    return false
  }
}

// ─── Renderer ─────────────────────────────────────────────────────────────────
// Pure: turns an alert row into a Discord message. Kept out of sendDiscord so
// it can be unit-tested without a network.

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

export function renderDiscord(input: {
  kind: string
  projectName: string
  projectUrl: string
  text: string
  payload?: Record<string, unknown> | null
  now?: Date
}): DiscordMessage {
  const { color, emoji } = colorFor(input.kind)
  const ts = (input.now ?? new Date()).toISOString()
  const host = (() => {
    try {
      return new URL(input.projectUrl).hostname
    } catch {
      return input.projectUrl
    }
  })()

  const embed: DiscordEmbed = {
    title: truncate(`${emoji} ${input.kind.replace(/[-_]/g, ' ')} — ${host}`, 256),
    description: truncate(input.text, 4096),
    color,
    fields: [
      { name: 'Project', value: truncate(input.projectName, 1024), inline: true },
      { name: 'URL', value: truncate(input.projectUrl, 1024), inline: true },
    ],
    footer: { text: 'ScanlyFix' },
    timestamp: ts,
  }

  return {
    content: truncate(`${emoji} ${input.kind} on ${host}`, 2000),
    username: 'ScanlyFix',
    embeds: [embed],
  }
}

// ─── Sender ───────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 10_000

/**
 * Send a Discord webhook. Never throws — Discord is a secondary channel and
 * a failure here must not affect email or the sentAt mark.
 */
export async function sendDiscord(
  webhookUrl: string,
  message: DiscordMessage,
): Promise<DiscordSendResult> {
  const msgParsed = DiscordMessageSchema.safeParse(message)
  if (!msgParsed.success) {
    return { sent: false, reason: 'Invalid Discord message shape' }
  }

  if (!isValidDiscordWebhookUrl(webhookUrl)) {
    return { sent: false, reason: 'Invalid or disallowed Discord webhook URL' }
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msgParsed.data),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!res.ok) {
      // Discord returns plain text on error. Cap it so a verbose error does
      // not bloat our logs.
      const body = await res.text().catch(() => '')
      console.warn(`[discord] Webhook returned ${res.status}: ${body.slice(0, 100)}`)
      return {
        sent: false,
        reason: `Discord returned ${res.status}: ${body.slice(0, 100)}`,
      }
    }

    return { sent: true }
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return { sent: false, reason: 'Discord request timed out after 10s' }
    }
    return {
      sent: false,
      reason: err instanceof Error ? err.message : 'Discord request failed',
    }
  }
}
