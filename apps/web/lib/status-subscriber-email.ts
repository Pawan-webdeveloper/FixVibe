/**
 * apps/web/lib/status-subscriber-email.ts
 *
 * Rendering + sending the two emails a public status-page subscriber
 * receives:
 *
 *   - Confirm-subscription (double opt-in)
 *   - Status update (incident created / updated / resolved)
 *
 * Pure rendering lives in this file; transport lives in lib/email.ts.
 * Same split as alert-email.ts / alert-message.ts.
 *
 * Every email carries BOTH the confirm/unsubscribe link so the
 * recipient has the off-switch where they are reading. The link uses
 * the SAME token — see status-subscribers.ts for why one secret covers
 * both actions.
 */

import 'server-only'
import {
  incidentUpdateStatusLabel,
  type IncidentUpdateStatus,
  type StatusSubscriber,
} from '@scanlyfix/db'
import { serverEnv } from './env.ts'
import { sendEmail, type Message, type SendResult } from './email.ts'

/* -------------------------------------------------------------------------- */
/* Shared rendering helpers                                                    */
/* -------------------------------------------------------------------------- */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function joinLines(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join('\n')
}

/** Escape a string for safe inclusion inside an HTML body. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Mirror of `text` so the email survives any client. */
function asHtml(text: string): string {
  const escaped = escapeHtml(text)
  return (
    `<pre style="font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;` +
    `color:#0f1115;white-space:pre-wrap;margin:0">${escaped}</pre>`
  )
}

/** URL the recipient lands on after clicking a token link. */
function linkUrl(token: string, action: 'confirm' | 'unsubscribe'): string {
  const base = serverEnv.appUrl.replace(/\/+$/, '')
  return `${base}/api/status/${action}?token=${encodeURIComponent(token)}`
}

/* -------------------------------------------------------------------------- */
/* Confirm-subscription email                                                  */
/* -------------------------------------------------------------------------- */

export interface ConfirmEmailInput {
  subscriber: Pick<StatusSubscriber, 'token'>
  projectName: string
  projectUrl: string
}

export interface RenderedConfirmEmail {
  subject: string
  text: string
  html: string
}

export function renderConfirmEmail(input: ConfirmEmailInput): RenderedConfirmEmail {
  const host = hostOf(input.projectUrl)
  const confirmUrl = linkUrl(input.subscriber.token, 'confirm')
  const unsubscribeUrl = linkUrl(input.subscriber.token, 'unsubscribe')
  const text = joinLines([
    `Confirm your subscription to ${input.projectName} status updates.`,
    '',
    `You (or somebody using this address) asked to receive incident notifications`,
    `for ${host}. Confirm to start receiving them — without this click the form`,
    `is just a request that nobody acts on.`,
    '',
    `Confirm: ${confirmUrl}`,
    '',
    `If this was not you, ignore this email — no subscription will be created.`,
    '',
    `Unsubscribe (any time): ${unsubscribeUrl}`,
  ])
  return {
    subject: `Confirm subscription to ${input.projectName} status updates`,
    text,
    html: asHtml(text),
  }
}

/* -------------------------------------------------------------------------- */
/* Status-update email                                                         */
/* -------------------------------------------------------------------------- */

/**
 * One notification to send to every confirmed-and-active subscriber.
 * The renderer is deliberately pure: the caller (the fan-out helper)
 * passes the already-collected data, and we format.
 *
 * `subscriber` is omitted at the fan-out call site because the helper
 * adds a per-recipient token just before the send. The renderer itself
 * still needs it (for the unsubscribe link), so the type makes it
 * optional but uses it when present.
 */
export interface StatusUpdateEmailInput {
  subscriber?: Pick<StatusSubscriber, 'token'>
  projectName: string
  projectUrl: string
  projectSlug: string
  incidentId: string
  /** Stage of the update — drives subject + tone. */
  stage: IncidentUpdateStatus
  /** Short summary line shown above the body. */
  headline: string
  /** The message body the on-call posted. */
  message: string
  /** Whether this is the first notification for the incident (vs. an update). */
  isInitial: boolean
}

export interface RenderedStatusUpdateEmail {
  subject: string
  text: string
  html: string
}

function subjectPrefix(stage: IncidentUpdateStatus, isInitial: boolean): string {
  if (stage === 'resolved') return '[RESOLVED]'
  if (isInitial) return '[INCIDENT]'
  return `[${incidentUpdateStatusLabel(stage).toUpperCase()}]`
}

export function renderStatusUpdateEmail(input: StatusUpdateEmailInput & { subscriber: Pick<StatusSubscriber, 'token'> }): RenderedStatusUpdateEmail {
  const host = hostOf(input.projectUrl)
  const statusUrl = `${serverEnv.appUrl.replace(/\/+$/, '')}/status/${input.projectSlug}`
  const unsubscribeUrl = linkUrl(input.subscriber.token, 'unsubscribe')

  const subject = `${subjectPrefix(input.stage, input.isInitial)} ${host}: ${input.headline}`

  const text = joinLines([
    input.headline,
    '',
    input.message,
    '',
    `Status page: ${statusUrl}`,
    '',
    `You're receiving this because you subscribed to ${input.projectName} status updates.`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ])

  return { subject, text, html: asHtml(text) }
}

/* -------------------------------------------------------------------------- */
/* Senders                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Send the confirmation email. Real entry point — caller passes the
 * recipient email + token from the upserted subscriber row.
 */
export async function sendSubscriberConfirmEmail(input: {
  email: string
  token: string
  projectName: string
  projectUrl: string
}): Promise<SendResult> {
  const rendered = renderConfirmEmail({
    subscriber: { token: input.token },
    projectName: input.projectName,
    projectUrl: input.projectUrl,
  })
  return sendEmail({
    to: input.email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  })
}

/** Send one status-update email. Used by the fan-out helper. */
export async function sendSubscriberStatusUpdateEmail(input: {
  email: string
  token: string
  payload: Omit<StatusUpdateEmailInput, 'subscriber'>
}): Promise<SendResult> {
  const rendered = renderStatusUpdateEmail({ ...input.payload, subscriber: { token: input.token } })
  return sendEmail({
    to: input.email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  })
}

/* -------------------------------------------------------------------------- */
/* Fan-out (used by incident flow + update flow)                               */
/* -------------------------------------------------------------------------- */

/**
 * Why this lives here rather than in packages/db: it touches the mail
 * transport, and packages/db must not learn about Resend. The DB side
 * (who to email) is a separate function in status-subscribers.ts.
 */

import {
  listConfirmedSubscribersForMonitor,
} from '@scanlyfix/db'

export interface SubscriberNotificationInput {
  monitorId: string
  email: StatusUpdateEmailInput
}

/**
 * Send a status-update email to every confirmed-and-active subscriber
 * for the project this monitor belongs to.
 *
 * Failures are logged, not thrown. The whole list of recipients should
 * not fail because one provider call timed out — and a failed send is
 * recoverable by a retry of the same incident update (the dedup key on
 * the caller's side is what makes a retry safe).
 */
export async function notifyConfirmedSubscribersForMonitor(
  input: SubscriberNotificationInput,
): Promise<{ delivered: number; failed: number }> {
  const subscribers = await listConfirmedSubscribersForMonitor(input.monitorId)
  if (subscribers.length === 0) return { delivered: 0, failed: 0 }

  let delivered = 0
  let failed = 0

  // Parallel dispatch, but per-recipient — each message carries a
  // personalised unsubscribe token, so batching into Resend's batch API
  // does not save anything here.
  await Promise.all(
    subscribers.map(async (sub) => {
      const result = await sendSubscriberStatusUpdateEmail({
        email: sub.email,
        token: sub.token,
        payload: input.email,
      })
      if (result.sent) delivered += 1
      else failed += 1
    }),
  )

  return { delivered, failed }
}
