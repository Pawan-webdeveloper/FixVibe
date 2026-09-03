/**
 * packages/db/src/queries/web-vitals.ts
 *
 * Web Vitals snapshots ke liye DB operations.
 *
 * WHY alag file (not monitors.ts mein): concerns separate rakhna —
 * web vitals specific queries apni jagah.
 */

import { db } from '../client.ts'
import { webVitalsSnapshots } from '../schema.ts'
import { eq, desc } from 'drizzle-orm'
import type { WebVitalsResult } from '@scanlyfix/checks'
import { z } from 'zod'

// ─── Insert Snapshot ───────────────────────────────────────────────────────────
/**
 * Naya web vitals snapshot insert karta hai.
 * WHY old snapshots delete nahi karte: historical trend ke liye useful.
 * Cleanup cronjob alag se laga sakte ho (e.g., 90 days se purane delete karo).
 */
export async function recordWebVitalsSnapshot(
  monitorId: string,
  vitals: Pick<WebVitalsResult, 'lcp' | 'fid' | 'cls' | 'fcp' | 'ttfb' | 'si'>,
): Promise<void> {
  await db.insert(webVitalsSnapshots).values({
    monitorId,
    lcp: vitals.lcp,
    fid: vitals.fid,
    cls: vitals.cls !== null ? parseFloat(vitals.cls.toFixed(4)) : null,
    fcp: vitals.fcp,
    ttfb: vitals.ttfb,
    si: vitals.si,
  })
}

// ─── Output Schema ─────────────────────────────────────────────────────────────
export const WebVitalsSnapshotSchema = z.object({
  id: z.string().uuid(),
  monitorId: z.string().uuid(),
  lcp: z.number().nullable(),
  fid: z.number().nullable(),
  cls: z.number().nullable(),
  fcp: z.number().nullable(),
  ttfb: z.number().nullable(),
  si: z.number().nullable(),
  ts: z.string().datetime(),
})

export type WebVitalsSnapshot = z.infer<typeof WebVitalsSnapshotSchema>

// ─── Get Latest Snapshot ───────────────────────────────────────────────────────
/**
 * Ek monitor ka latest web vitals snapshot fetch karta hai.
 * WHY: Alert mein "previous vs current" comparison ke liye useful.
 */
export async function getLatestWebVitalsSnapshot(
  monitorId: string,
): Promise<WebVitalsSnapshot | null> {
  const row = await db.query.webVitalsSnapshots.findFirst({
    where: eq(webVitalsSnapshots.monitorId, monitorId),
    orderBy: [desc(webVitalsSnapshots.ts)],
  })

  if (!row) return null

  const parsed = WebVitalsSnapshotSchema.safeParse({
    ...row,
    ts: row.ts.toISOString(),
  })

  return parsed.success ? parsed.data : null
}

// ─── Get Recent Snapshots ──────────────────────────────────────────────────────
/**
 * Recent N snapshots fetch karta hai — trend chart ke liye.
 */
export async function getRecentWebVitalsSnapshots(
  monitorId: string,
  limit = 30,
): Promise<WebVitalsSnapshot[]> {
  const safeLimit = Math.min(Math.max(1, limit), 100)

  const rows = await db.query.webVitalsSnapshots.findMany({
    where: eq(webVitalsSnapshots.monitorId, monitorId),
    orderBy: [desc(webVitalsSnapshots.ts)],
    limit: safeLimit,
  })

  return rows
    .map((row) =>
      WebVitalsSnapshotSchema.safeParse({
        ...row,
        ts: row.ts.toISOString(),
      }),
    )
    .filter((r) => r.success)
    .map((r) => r.data!)
}