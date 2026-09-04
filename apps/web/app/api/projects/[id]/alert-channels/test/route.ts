/**
 * apps/web/app/api/projects/[id]/alert-channels/test/route.ts
 *
 * POST /api/projects/:id/alert-channels/test
 *
 * Send a "this is what an alert looks like here" message to one configured
 * channel. The body of the message travels through the exact same senders
 * the production alert path uses — SSRF guard, timeout, retry, all of it —
 * so a successful response is evidence the channel works end-to-end, not
 * just evidence the config is well-formed.
 *
 * Body: { channelId: string }
 *
 * Returns:
 *   200 { sent: true }                     — the receiver accepted the test
 *   200 { sent: false, reason }            — the receiver refused (4xx, timeout,
 *                                           invalid URL). The reason is safe
 *                                           to display; we never include the
 *                                           URL or any secret.
 *   400 { error }                          — bad request shape
 *   401 { error: 'Unauthorized' }          — anonymous viewer
 *   404 { error: 'Channel not found' }     — wrong id, or no ownership, or
 *                                           the channel belongs to a different
 *                                           project than the URL names
 *
 * WHY a separate route from the save route: the save route must succeed
 * even if the URL is temporarily down (a saved URL is the source of truth
 * for future alerts). The test route is the user-initiated liveness check;
 * a failure here is a "fix it" signal, not a "rejected" signal.
 */

import { NextResponse } from 'next/server'
import { getAlertChannel } from '@scanlyfix/db'
import { getViewer } from '@/lib/authz.ts'
import { sendTestSlack, sendTestDiscord, sendTestWebhook } from '@/lib/test-alert.ts'
import { z } from 'zod'

export const runtime = 'nodejs'

// ─── Validation ───────────────────────────────────────────────────────────────

const TestChannelSchema = z.object({
  channelId: z.string().uuid('channelId must be a UUID'),
})

// ─── Handler ──────────────────────────────────────────────────────────────────

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: Request, { params }: RouteContext) {
  const viewer = await getViewer()
  if (viewer.kind !== 'user') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: projectId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = TestChannelSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  // getAlertChannel enforces ownership AND (when expectedProjectId is
  // supplied) verifies the channel belongs to the URL's project. Either
  // mismatch returns null, so a non-member cannot probe which channel ids
  // exist, and a request body cannot fish a channel id from another project.
  const channel = await getAlertChannel(parsed.data.channelId, viewer, projectId)
  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }

  // Dispatch by channel kind. Each sender returns { sent, reason? } — the
  // reason is safe to surface to the UI (it never includes the URL or the
  // secret).
  let result: { sent: boolean; reason?: string }
  switch (channel.channel) {
    case 'slack':
      result = await sendTestSlack(channel.config)
      break
    case 'discord':
      result = await sendTestDiscord(channel.config)
      break
    case 'webhook':
      result = await sendTestWebhook(channel.config)
      break
    case 'email':
      // Email test-send is a different surface (sends to the project owner)
      // and out of scope here.
      return NextResponse.json(
        { error: 'Test send is not supported for email channels' },
        { status: 400 },
      )
    default:
      return NextResponse.json({ error: 'Unknown channel type' }, { status: 400 })
  }

  return NextResponse.json(result)
}
