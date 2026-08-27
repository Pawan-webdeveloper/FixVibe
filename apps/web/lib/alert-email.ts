/**
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
 */

import 'server-only'
import { alertForDelivery, markAlertSent } from '@scanlyfix/db'
import { render } from './alert-message.ts'
import { sendEmail, type SendResult } from './email.ts'

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

export async function deliverAlert(alertId: string): Promise<SendResult> {
  const alert = await alertForDelivery(alertId)
  if (!alert) return { sent: false, reason: 'alert no longer exists' }

  // Belt and braces against a step re-running after the mark. recordAlertOnce
  // already stops a second alert being raised; this stops a second send of the
  // same one.
  if (alert.sentAt) return { sent: false, reason: 'already delivered' }

  const { subject, text } = render(alert)
  const result = await sendEmail({
    to: alert.recipientEmail,
    subject,
    text,
    html: asHtml(text),
  })

  // Marked only on acceptance. A row with a null sentAt is an alert the
  // customer never received, and that has to stay findable.
  if (result.sent) await markAlertSent(alert.id)
  return result
}
