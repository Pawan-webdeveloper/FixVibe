/**
 * apps/web/lib/test-alert.ts
 *
 * Build a "this is what an alert looks like here" message for any channel
 * type, and dispatch it through the existing senders.
 *
 * The point is the same as the production alert path: a test send is the
 * ONLY way to confirm a webhook URL is reachable, a bot is still in the
 * channel, and the configured secret matches. Schema validation cannot do
 * that — a perfectly-formed POST to a URL the customer typo'd will look
 * like a success to the database.
 *
 * Reuses the existing sendSlack / sendDiscord / sendWebhook so the test
 * message goes through the same SSRF guard, the same timeout, the same
 * retry rules. The only thing that differs is the body, and the body is
 * what receivers see first.
 */

import 'server-only'
import { serverEnv } from './env.ts'
import { sendSlack } from './slack.ts'
import { sendDiscord, renderDiscord } from './discord.ts'
import { buildWebhookPayload, sendWebhook } from './webhook.ts'

// ─── Test message shapes ──────────────────────────────────────────────────────

const TEST_MARKER = '✅ Test alert'

function testText(): string {
  const app = serverEnv.appUrl
  return (
    `${TEST_MARKER} from ${app} — you'll receive monitoring alerts here.\n\n` +
    `This message was sent to verify your alert channel is configured correctly. ` +
    `If you can read this, the channel works — no action required.`
  )
}

function testSubject(): string {
  return `${TEST_MARKER} from ${serverEnv.appUrl}`
}

// ─── Per-channel senders ──────────────────────────────────────────────────────
// Each entry knows how to send a test message for one channel kind, given
// the stored config. Returns the same { sent, reason } shape as the
// production senders so the API route can pass the result through.

export interface TestSendResult {
  sent: boolean
  reason?: string
}

export async function sendTestSlack(config: unknown): Promise<TestSendResult> {
  if (typeof config !== 'object' || config === null) {
    return { sent: false, reason: 'Invalid Slack channel config' }
  }
  const url = (config as Record<string, unknown>).webhookUrl
  if (typeof url !== 'string') {
    return { sent: false, reason: 'Invalid Slack channel config' }
  }
  return sendSlack(url, { text: testText() })
}

export async function sendTestDiscord(config: unknown): Promise<TestSendResult> {
  if (typeof config !== 'object' || config === null) {
    return { sent: false, reason: 'Invalid Discord channel config' }
  }
  const url = (config as Record<string, unknown>).webhookUrl
  if (typeof url !== 'string') {
    return { sent: false, reason: 'Invalid Discord channel config' }
  }

  // Use renderDiscord so the test message uses the SAME embed machinery the
  // production alert path uses — green embed, ScanlyFix footer, the works.
  // The kind 'test_alert' is not in any of our color buckets, so it falls
  // through to the default (blue) — visually distinct from real alerts.
  const message = renderDiscord({
    kind: 'test_alert',
    projectName: 'ScanlyFix',
    projectUrl: serverEnv.appUrl,
    text: testText(),
    payload: null,
  })
  return sendDiscord(url, message)
}

export async function sendTestWebhook(config: unknown): Promise<TestSendResult> {
  if (typeof config !== 'object' || config === null) {
    return { sent: false, reason: 'Invalid webhook channel config' }
  }
  const obj = config as Record<string, unknown>
  if (typeof obj.url !== 'string' || !obj.url.startsWith('https://')) {
    return { sent: false, reason: 'Invalid webhook URL' }
  }
  // Use the standardized payload shape. severity is fixed to 'info' for tests
  // — receivers should never page on a test send.
  const payload = buildWebhookPayload({
    kind: 'test_alert',
    projectName: 'ScanlyFix',
    monitorType: 'uptime',
    url: serverEnv.appUrl,
    payload: { test: true, message: testSubject() },
  })
  return sendWebhook(
    { url: obj.url, secret: typeof obj.secret === 'string' ? obj.secret : undefined },
    payload,
  )
}
