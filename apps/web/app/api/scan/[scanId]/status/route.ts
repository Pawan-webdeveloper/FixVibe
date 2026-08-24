/**
 * Poll a scan's state.
 *
 * Polling rather than a realtime subscription. The client needs one bit — is it
 * finished — and a two-second poll costs one indexed row read, where a realtime
 * channel costs a subscription lifecycle, a reconnect story and a second
 * transport to debug. This endpoint is also what the public API needs in Phase
 * 7, so it is one endpoint doing two jobs rather than two systems doing one.
 *
 * Unused while scans run inline; it is what makes the deep profile possible.
 */

import { NextResponse } from 'next/server'
import { getScanForViewer } from '@darvin/db'
import { getViewer } from '@/lib/authz.ts'

export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params
  // Postgres answers a malformed uuid with an error, so filter before querying.
  if (!UUID.test(scanId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const scan = await getScanForViewer(scanId, await getViewer())
  if (!scan) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    scanId: scan.id,
    status: scan.status,
    // Enough for the client to decide whether to stop polling and reload, and
    // nothing that would let a poll substitute for reading the report.
    findingCount: scan.findings.length,
    overall: scan.scores?.overall ?? null,
    error: scan.error,
  })
}
