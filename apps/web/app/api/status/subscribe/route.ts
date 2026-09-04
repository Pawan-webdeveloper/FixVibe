/**
 * apps/web/app/api/status/subscribe/route.ts
 *
 * POST /api/status/subscribe
 *
 * Body: { slug: string, email: string }
 *
 * Public endpoint — no authentication, no account required. The
 * slug is the project's public handle (visible on the /status/[slug]
 * page); it is the only piece of project metadata exposed here.
 *
 * Flow:
 *   1. Validate body (slug shape, email shape).
 *   2. Resolve slug → project. 404 if the project does not exist.
 *   3. IP rate limit (5/hour). 429 if exceeded.
 *   4. Idempotent upsert into status_subscribers.
 *   5. Send confirmation email — never tell the caller whether the
 *      address was already on the list (avoid address-enumeration).
 *
 * Responses:
 *   200 { ok: true }                  — accepted; check your inbox
 *   400 { error }                     — invalid slug or email shape
 *   404 { error: 'project not found' }
 *   429 { error, retryAfterSeconds }  — rate limit exceeded
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createStatusSubscriber,
  getProjectForSubscribe,
  isValidEmail,
  normalizeEmail,
} from '@scanlyfix/db'
import { clientIpHash } from '@/lib/request.ts'
import { checkSubscribeAllowed } from '@/lib/ratelimit-status-subscribe.ts'
import { sendSubscriberConfirmEmail } from '@/lib/status-subscriber-email.ts'

export const runtime = 'nodejs'

const SLUG_REGEX = /^[a-z0-9-]+$/

const BodySchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .refine((s) => SLUG_REGEX.test(s), 'Invalid project slug'),
  email: z.string().min(1).max(320),
})

export async function POST(request: Request) {
  // ── 1. Body validation ──────────────────────────────────────────────────
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  const email = normalizeEmail(parsed.data.email)
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  // ── 2. Project resolution ───────────────────────────────────────────────
  const project = await getProjectForSubscribe(parsed.data.slug)
  if (!project) {
    // Same response we give for an existing project to avoid slug
    // enumeration — but a 404 here is also fine; the slug is not a
    // secret. Keeping 404 because the form has nothing useful to say.
    return NextResponse.json({ error: 'project not found' }, { status: 404 })
  }

  // ── 3. Rate limit ───────────────────────────────────────────────────────
  const ipHash = clientIpHash(request.headers)
  const verdict = await checkSubscribeAllowed(ipHash)
  if (!verdict.ok) {
    return NextResponse.json(
      { error: verdict.reason, retryAfterSeconds: verdict.retryAfterSeconds },
      { status: 429 },
    )
  }

  // ── 4. Upsert subscriber ────────────────────────────────────────────────
  const subscriber = await createStatusSubscriber({
    projectId: project.id,
    email,
    ipHash,
  })
  if (!subscriber) {
    // Already covered by the email-validation step above, but the
    // upsert can also fail on a DB error. Treat both as "try again".
    return NextResponse.json(
      { error: 'Could not subscribe — try again later' },
      { status: 500 },
    )
  }

  // ── 5. Send confirmation ────────────────────────────────────────────────
  // Failure to send does NOT roll back the row: the user can request a
  // resend by submitting the form again (idempotent upsert rotates the
  // token). The transport reports failure via sendEmail; we ignore the
  // result on purpose — the row is the durable record.
  await sendSubscriberConfirmEmail({
    email,
    token: subscriber.token,
    projectName: project.name,
    projectUrl: project.url,
  })

  // Identical success message regardless of whether the row already
  // existed — never tell an attacker which addresses are on the list.
  return NextResponse.json({
    ok: true,
    message: 'Check your inbox to confirm your subscription.',
  })
}
