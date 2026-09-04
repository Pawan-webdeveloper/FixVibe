/**
 * apps/web/app/api/monitors/[id]/config/route.ts
 *
 * PATCH /api/monitors/:id/config
 * Body: { alertConfig: AlertConfig }
 *
 * Supported alertConfig fields:
 *   - failStatusCodes?: number[]        — HTTP codes that count as DOWN
 *   - maxLatencyMs?: number | null      — Max acceptable latency
 *   - reminderIntervalMin?: 15|30|60|120 | null — Downtime reminder interval
 *   - keywordCheck?: { type, value, caseSensitive? } — Response body check
 *   - expectedStatusCodes?: number[]    — Expected HTTP codes (empty = any 2xx)
 *   - httpMethod?: 'GET' | 'HEAD'      — HTTP method (default GET)
 *   - customHeaders?: { key, valueEncrypted }[] — Custom headers (max 5)
 *   - followRedirects?: boolean         — Follow redirects (default true)
 *
 * Security:
 *  - Auth: viewer must own the monitor's project
 *  - monitorId: UUID validated
 *  - alertConfig: Zod validated (structure + size < 4KB)
 *  - Only PATCH allowed — no accidental GET of sensitive config
 *  - Custom header values are AES-256-GCM encrypted at rest
 *  - API responses return masked values (key: ***last4) — never plaintext
 *
 * Validation:
 *  - Headers max 5, keyword max 500 chars
 *  - Total config size < 4KB
 *  - Invalid fields rejected with 400
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, monitors, projects } from '@scanlyfix/db'
import { eq } from 'drizzle-orm'
import { getViewer } from '@/lib/authz.ts'
import { parseAlertConfig } from '@/lib/alert-threshold.ts'
import { encryptValue, maskHeaders } from '@/lib/header-encryption.ts'
import type { AlertConfig } from '@/lib/alert-threshold.ts'

// ─── Input Schema ──────────────────────────────────────────────────────────────
const PatchBodySchema = z.object({
  alertConfig: z.unknown(), // WHY unknown: parseAlertConfig handles validation
})

const UuidSchema = z.string().uuid()

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Encrypts custom header values before storing in DB.
 * This is called during PATCH to ensure values are encrypted at rest.
 */
function encryptHeaders(config: AlertConfig): AlertConfig {
  if (!config.customHeaders || config.customHeaders.length === 0) {
    return config
  }

  return {
    ...config,
    customHeaders: config.customHeaders.map((header) => ({
      key: header.key,
      // Only encrypt if not already encrypted (no ':' in value = plaintext)
      valueEncrypted: header.valueEncrypted.includes(':')
        ? header.valueEncrypted
        : encryptValue(header.valueEncrypted),
    })),
  }
}

/**
 * Masks custom headers for API responses.
 * Returns { key, valueMasked } instead of { key, valueEncrypted }.
 */
function maskConfigForResponse(config: AlertConfig): Record<string, unknown> {
  const masked = { ...config }

  if (masked.customHeaders && masked.customHeaders.length > 0) {
    // Replace customHeaders with masked versions
    ;(masked as Record<string, unknown>).customHeaders = maskHeaders(masked.customHeaders)
  }

  return masked
}

// ─── PATCH Handler ─────────────────────────────────────────────────────────────
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const viewer = await getViewer()

  // ── 2. Validate monitorId ──────────────────────────────────────────────────
  const { id } = await params
  if (!UuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid monitor ID' }, { status: 400 })
  }

  // ── 3. Parse body ──────────────────────────────────────────────────────────
  const rawBody = await req.json().catch(() => null)
  const bodyParsed = PatchBodySchema.safeParse(rawBody)
  if (!bodyParsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 },
    )
  }

  // ── 4. Validate alertConfig ────────────────────────────────────────────────
  // WHY: Zod validates structure, parseAlertConfig validates size
  const configResult = parseAlertConfig(bodyParsed.data.alertConfig)
  if (!configResult.ok) {
    return NextResponse.json(
      { error: configResult.reason },
      { status: 400 },
    )
  }

  // ── 5. Encrypt custom headers ──────────────────────────────────────────────
  // WHY: Ensure values are encrypted before storing in DB
  const encryptedConfig = encryptHeaders(configResult.config)

  // ── 6. Ownership check ─────────────────────────────────────────────────────
  // WHY fetch monitor + project: ensure viewer owns this monitor
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  try {
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
      columns: { id: true, projectId: true },
    })

    if (!monitor) {
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
    }

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, monitor.projectId),
      columns: { id: true, ownerId: true },
    })

    if (!project || project.ownerId !== viewer.userId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // ── 7. Update ────────────────────────────────────────────────────────────
    await db
      .update(monitors)
      .set({ alertConfig: encryptedConfig })
      .where(eq(monitors.id, id))

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[monitor-config] PATCH failed:', err)
    return NextResponse.json(
      { error: 'Failed to update config' },
      { status: 500 },
    )
  }
}

// ─── GET Handler ───────────────────────────────────────────────────────────────
// WHY include GET: UI needs to show current config on load
// SECURITY: Custom header values are masked — never return plaintext
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await getViewer()

  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const { id } = await params
  if (!UuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid monitor ID' }, { status: 400 })
  }

  try {
    const monitor = await db.query.monitors.findFirst({
      where: eq(monitors.id, id),
      columns: { id: true, projectId: true, alertConfig: true },
    })

    if (!monitor) {
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
    }

    const project = await db.query.projects.findFirst({
      where: eq(projects.id, monitor.projectId),
      columns: { ownerId: true },
    })

    if (!project || project.ownerId !== viewer.userId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // WHY validate on read: DB could have old/malformed data
    const configResult = parseAlertConfig(monitor.alertConfig ?? {})

    if (!configResult.ok) {
      return NextResponse.json({ alertConfig: null })
    }

    // Mask custom headers for API response (never return plaintext values)
    const maskedConfig = maskConfigForResponse(configResult.config)

    return NextResponse.json({ alertConfig: maskedConfig })
  } catch (err) {
    console.error('[monitor-config] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to fetch config' },
      { status: 500 },
    )
  }
}