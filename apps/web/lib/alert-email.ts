/**
 * apps/web/lib/alert-email.ts
 *
 * Turning a recorded alert into a message somebody receives.
 *
 * Delivery takes an alert ID and nothing else. The row already carries the
 * kind, the payload and the project, so a send that failed can be retried
 * later from an id alone — by the queue, by a sweep, or by hand — without the
 * job that raised it still being around.
 *
 * `sentAt` is written only after the provider accepted the message. An alert
 * with a null `sentAt` is therefore exactly what it looks like: something the
 * customer was never told. That is the number worth watching in this product.
 *
 * The wording lives in alert-message.ts, which is pure and therefore testable
 * without a database or a mail provider. This file is the orchestration: look
 * it up, render it, send it, record that it went.
 *
 * Slack is a secondary channel — its failure never affects email delivery
 * or the sentAt mark. Email remains the source of truth for "was this sent."
 */

import 'server-only'
import { alertForDelivery, markAlertSent, getAlertChannels } from '@scanlyfix/db'
import { render, renderSlack } from './alert-message.ts'
import { sendEmail, type SendResult } from './email.ts'
import { sendSlack } from './slack.ts'

// ─── HTML Helper ───────────────────────────────────────────────────────────────
/** A mirror of the text, never a second version of it with different facts. */
function asHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return (
    `<pre style="font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;` +
    `color:#0f1115;white-space:pre-wrap;margin:0">${escaped}</pre>`
  )
}

// ─── Slack Delivery Helper ─────────────────────────────────────────────────────
/**
 * WHY separate function (not inline in deliverAlert):
 * - Clean separation — deliverAlert stays readable
 * - Easy to test Slack path in isolation
 * - Slack fetch karna: channels list + send — alag concern
 *
 * WHY never throws:
 * - Email primary channel hai
 * - Slack failure = log karo, continue karo
 * - sentAt sirf email acceptance pe set hota hai
 */
async function tryDeliverSlack(
  projectId: string,
  alert: Awaited<ReturnType<typeof alertForDelivery>>,
): Promise<void> {
  if (!alert) return

  try {
    // Internal overload — full config (not masked)
    const channels = (await getAlertChannels(projectId)) ?? []
    const slackChannel = channels.find(
      (c) => c.channel === 'slack' && c.enabled,
    )

    if (!slackChannel) return

    const webhookUrl = slackChannel.config.webhookUrl as string | undefined
    if (!webhookUrl) return

    const slackMessage = renderSlack(alert)
    const result = await sendSlack(webhookUrl, slackMessage)

    if (!result.sent) {
      // WHY warn not error: Slack is secondary — not a critical failure
      console.warn(
        `[alert] Slack delivery failed for alert ${alert.id}: ${result.reason}`,
      )
    }
  } catch (err) {
    // WHY catch all: Slack must never crash email delivery
    console.error(`[alert] Slack delivery threw for alert ${alert.id}:`, err)
  }
}

// ─── Main Delivery ─────────────────────────────────────────────────────────────

export async function deliverAlert(alertId: string): Promise<SendResult> {
  const alert = await alertForDelivery(alertId)
  if (!alert) return { sent: false, reason: 'alert no longer exists' }

  // Belt and braces against a step re-running after the mark. recordAlertOnce
  // already stops a second alert being raised; this stops a second send of the
  // same one.
  if (alert.sentAt) return { sent: false, reason: 'already delivered' }

  const { subject, text } = render(alert)

  // ── Primary: Email ─────────────────────────────────────────────────────────
  const result = await sendEmail({
    to: alert.recipientEmail,
    subject,
    text,
    html: asHtml(text),
  })

  // Marked only on acceptance. A row with a null sentAt is an alert the
  // customer never received, and that has to stay findable.
  if (result.sent) await markAlertSent(alert.id)

  // ── Secondary: Slack ───────────────────────────────────────────────────────
  // WHY after email + markAlertSent:
  //  1. Email is primary — its success/failure is what matters
  //  2. sentAt mark should not be blocked by Slack
  //  3. Slack failure never changes what we return to caller
  //
  // WHY await (not void/fire-and-forget):
  //  In Inngest step.run, the step completes after this function returns.
  //  fire-and-forget = Slack send might not finish before step ends.
  //  Awaiting = controlled, logged, reliable.
  await tryDeliverSlack(alert.projectId, alert)

  return result
}