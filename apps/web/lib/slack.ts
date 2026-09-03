/**
 * Slack incoming webhook sender.
 *
 * Security:
 *  - `server-only` — ye file kabhi client bundle mein nahi jayegi
 *  - Webhook URL validate karta hai — sirf hooks.slack.com allow (SSRF prevention)
 *  - Webhook URL kabhi log nahi hoti (it's a secret)
 *  - 10s timeout — Slack slow hone pe probe/delivery block na ho
 *  - Message Zod se validate hota hai before send
 *
 * WHY incoming webhook (not Slack Bot API):
 *  - No OAuth setup, no bot token needed
 *  - User sirf ek URL paste karta hai — zero friction
 *  - Enough for one-way alert delivery
 */

import 'server-only'
import { z } from 'zod'

// ─── Types ─────────────────────────────────────────────────────────────────────

export const SlackMessageSchema = z.object({
  // Fallback text — shown in notifications, desktop alerts, accessibility
  text: z.string().min(1).max(3000),
  blocks: z
    .array(
      z.object({
        type: z.enum(['section', 'divider', 'header', 'context']),
        text: z
          .object({
            type: z.enum(['plain_text', 'mrkdwn']),
            text: z.string().max(3000),
          })
          .optional(),
      }),
    )
    .max(50)
    .optional(),
})

export type SlackMessage = z.infer<typeof SlackMessageSchema>

export interface SlackSendResult {
  sent: boolean
  reason?: string
}

// ─── Webhook URL Validator ─────────────────────────────────────────────────────
// WHY validate at send time (not only at save time):
// DB mein tampered value aa sakti hai — defense in depth

const ALLOWED_SLACK_HOSTS = new Set([
  'hooks.slack.com',
  'hooks-regional.slack.com', // Slack Enterprise regional endpoints
])

export function isValidSlackWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (!ALLOWED_SLACK_HOSTS.has(parsed.hostname)) return false
    // Slack webhook path is always /services/T.../B.../...
    if (!parsed.pathname.startsWith('/services/')) return false
    return true
  } catch {
    return false
  }
}

// ─── Sender ────────────────────────────────────────────────────────────────────

/**
 * Slack webhook pe message bhejta hai.
 *
 * WHY never throws:
 * `deliverAlert` mein email primary channel hai.
 * Slack failure email delivery ko affect nahi karni chahiye.
 * Structured result return karo — caller decide kare kya karna hai.
 */
export async function sendSlack(
  webhookUrl: string,
  message: SlackMessage,
): Promise<SlackSendResult> {
  // Validate message shape
  const msgParsed = SlackMessageSchema.safeParse(message)
  if (!msgParsed.success) {
    return { sent: false, reason: 'Invalid Slack message shape' }
  }

  // Validate URL (SSRF check)
  // WHY not log the URL if invalid: webhook URL is a secret
  if (!isValidSlackWebhookUrl(webhookUrl)) {
    return { sent: false, reason: 'Invalid or disallowed Slack webhook URL' }
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msgParsed.data),
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      // Slack returns plain text error ("invalid_token", "channel_not_found" etc.)
      const body = await res.text().catch(() => '')
      // WHY not include URL in log: it's a secret
      console.warn(`[slack] Webhook returned ${res.status}: ${body.slice(0, 100)}`)
      return {
        sent: false,
        reason: `Slack returned ${res.status}: ${body.slice(0, 100)}`,
      }
    }

    return { sent: true }
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { sent: false, reason: 'Slack request timed out after 10s' }
    }
    return {
      sent: false,
      reason: err instanceof Error ? err.message : 'Slack request failed',
    }
  }
}