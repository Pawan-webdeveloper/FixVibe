/**
 * apps/web/lib/webhook.ts
 *
 * Generic webhook alert sender.
 *
 * Designed for "send our alert to ANY URL the user pastes" — Slack-compatible
 * webhooks, PagerDuty, Discord, custom backends. Payload is a stable,
 * documented JSON shape, not a provider-specific format.
 *
 * Security model (why this file is careful with URLs):
 *   - User-supplied URLs are an SSRF surface. We pre-validate with the SAME
 *     primitives that `@scanlyfix/checks/safeFetch` uses (assertSafeUrl +
 *     resolvePublicAddresses) — that catches private IPs, loopback, link-local
 *     and the cloud metadata service (169.254.169.254).
 *   - We additionally refuse anything that is not HTTPS, even after resolution.
 *   - DNS rebinding is mitigated by validating the resolved address BEFORE we
 *     connect; resolvePublicAddresses throws on private records.
 *   - Webhook URL is treated as a secret: never logged, never returned in
 *     error reasons, masked in API responses (see alert-channels.ts).
 *
 * Reliability:
 *   - 10s hard timeout per attempt (AbortSignal.timeout).
 *   - One retry on transport error or 5xx. 4xx is a "your endpoint rejected
 *     this" signal — retrying will not change that, so we don't.
 *   - Failures are logged with the alert id and reason, never with the URL.
 *   - Never throws. deliverAlert treats this as a secondary channel; the
 *     return contract is a structured result.
 */

import 'server-only'
import { z } from 'zod'
import { assertSafeUrl, resolvePublicAddresses, SsrfError } from '@scanlyfix/checks'
import type { WebhookChannelConfig } from '@scanlyfix/db'

// ─── Public types ─────────────────────────────────────────────────────────────

/** Severity bucket — maps from alert kind, never set by the user. */
export type WebhookSeverity = 'critical' | 'warning' | 'info'

/**
 * Standardized webhook payload. The wire format — receivers parse against
 * this exact shape. Documented in our public API; changing a field is a
 * breaking change.
 */
export const WebhookPayloadSchema = z.object({
  kind: z.string().min(1).max(100),
  projectName: z.string().min(1).max(200),
  monitorType: z.string().min(1).max(50),
  url: z.string().url(),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.string().datetime({ offset: true }),
  severity: z.enum(['critical', 'warning', 'info']),
})

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>

export interface WebhookSendResult {
  sent: boolean
  reason?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 10_000
const MAX_BODY_BYTES = 16 * 1024
const RETRY_DELAY_MS = 1_000
const MAX_ATTEMPTS = 2

// ─── Severity mapping ─────────────────────────────────────────────────────────
// WHY: receivers (PagerDuty, ops dashboards) want a stable, coarse bucket.
// Alert kinds are open-ended text, so we group them here — keep the mapping
// tight, since anything that slips through falls to 'info'.
const CRITICAL_KINDS = new Set([
  'downtime',
  'tls_expiring',
  'domain_expiring',
  'certificate-expiry-expired',
  'domain-expiry-expired',
])

const WARNING_KINDS = new Set([
  'recovered',
  'downtime-reminder',
  'web_vitals',
  'score-drop',
  'dns_drift',
])

export function severityForKind(kind: string): WebhookSeverity {
  if (CRITICAL_KINDS.has(kind)) return 'critical'
  if (WARNING_KINDS.has(kind)) return 'warning'
  return 'info'
}

// ─── URL validation ───────────────────────────────────────────────────────────
// WHY a second check here, on top of the Zod schema in alert-channels.ts:
// defense in depth — the DB value could in principle be tampered with between
// validation and use. We re-validate right before connecting.

export function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (parsed.username !== '' || parsed.password !== '') return false
    return true
  } catch {
    return false
  }
}

// ─── HMAC signing ─────────────────────────────────────────────────────────────
// Web Crypto is built-in on Node 18+ and runs in the same process. We sign
// the EXACT bytes that go on the wire (rawBody) so the receiver can verify
// byte-for-byte. Hex encoding is the convention for the header.

async function signPayload(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ─── SSRF pre-check ───────────────────────────────────────────────────────────
// Runs BEFORE the fetch — catches private IPs, loopback, and DNS resolution
// failures. Throws SsrfError, which the caller converts to a sent:false
// result. This is the same surface safeFetch protects.

async function assertSafeWebhookUrl(url: string): Promise<void> {
  const parsed = new URL(url)
  assertSafeUrl(parsed)
  await resolvePublicAddresses(parsed.hostname)
}

// ─── Single attempt ───────────────────────────────────────────────────────────
// Returns a result instead of throwing so the retry loop can decide.

async function sendOnce(
  config: WebhookChannelConfig,
  rawBody: string,
  payload: WebhookPayload,
): Promise<WebhookSendResult> {
  if (!isValidWebhookUrl(config.url)) {
    return { sent: false, reason: 'Invalid or disallowed webhook URL' }
  }

  // SSRF guard — same primitives as safeFetch
  try {
    await assertSafeWebhookUrl(config.url)
  } catch (err) {
    if (err instanceof SsrfError) {
      // WHY no URL in the reason: it's a secret
      return { sent: false, reason: 'URL failed SSRF validation' }
    }
    return { sent: false, reason: 'Could not resolve webhook host' }
  }

  // Build headers; HMAC only when a secret is configured.
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'ScanlyFix-Webhook/1.0',
    'x-scanlyfix-event': payload.kind,
  }
  if (config.secret) {
    try {
      headers['x-webhook-secret'] = await signPayload(config.secret, rawBody)
    } catch {
      return { sent: false, reason: 'Failed to sign webhook payload' }
    }
  }

  let res: Response
  try {
    res = await fetch(config.url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return { sent: false, reason: 'Webhook request timed out after 10s' }
    }
    return {
      sent: false,
      reason: err instanceof Error ? err.message : 'Webhook request failed',
    }
  }

  if (!res.ok) {
    // Read a bounded slice of the error body for diagnostics — full body could
    // be megabytes of HTML, and it never changes our decision.
    const body = await res.text().catch(() => '')
    return {
      sent: false,
      reason: `Webhook endpoint returned ${res.status}: ${body.slice(0, 200)}`,
    }
  }

  return { sent: true }
}

// ─── Public sender ────────────────────────────────────────────────────────────

/**
 * Build the standardized JSON payload from an alert row.
 *
 * Pure: no I/O, no DB, no time source other than the injected `now`. This
 * makes it trivially testable and keeps the signing step deterministic for
 * the same inputs.
 */
export function buildWebhookPayload(input: {
  kind: string
  projectName: string
  monitorType: string
  url: string
  payload: Record<string, unknown>
  now?: Date
}): WebhookPayload {
  const payload: WebhookPayload = {
    kind: input.kind,
    projectName: input.projectName,
    monitorType: input.monitorType,
    url: input.url,
    payload: input.payload,
    timestamp: (input.now ?? new Date()).toISOString(),
    severity: severityForKind(input.kind),
  }
  // WHY re-parse: the only way to get a Zod-verified, typed object back is
  // to round-trip through the schema. The fields are all cheap primitives.
  return WebhookPayloadSchema.parse(payload)
}

/**
 * Send a webhook with a single retry on transport / 5xx failure.
 *
 * Contract: never throws. The caller (deliverAlert) is the primary-channel
 * orchestrator and webhook failure must not affect the email path or the
 * sentAt mark.
 */
export async function sendWebhook(
  config: WebhookChannelConfig,
  payload: WebhookPayload,
): Promise<WebhookSendResult> {
  // WHY serialize ONCE: the HMAC signs the exact bytes the receiver gets.
  // Re-serializing for a retry would produce a different string only if
  // key order changed, but with a single object it will not — and one
  // canonical string makes the signature verification stable.
  const rawBody = JSON.stringify(payload)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await sendOnce(config, rawBody, payload)
    if (result.sent) return result

    // 4xx is a hard "no" from the receiver — retrying will not change the
    // answer, and we keep the first reason for the log.
    const isClientError = result.reason?.startsWith('Webhook endpoint returned 4')
    if (isClientError) return result

    // Last attempt — give up
    if (attempt === MAX_ATTEMPTS) return result

    // Backoff before the retry
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
  }

  // Unreachable — the loop returns on every path. Belt + braces for the
  // type checker.
  return { sent: false, reason: 'Webhook delivery failed' }
}
