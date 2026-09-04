/**
 * packages/db/src/queries/psi-cache.ts
 *
 * PSI API result cache — 6h TTL keyed by normalized URL.
 *
 * WHY:
 *   - PSI free tier = 25k req/month — caching avoids redundant Lighthouse runs
 *   - Same URL polled every 10min = 144 calls/day without cache → quota burns in ~5.7 days
 *   - With 6h cache: 4 calls/day per URL → 25k lasts ~17 years (per URL)
 *
 * WHY not Redis:
 *   - Postgres already available — no new infra
 *   - PSI results are JSONB — no serialization overhead
 *   - Cleanup cron can reuse existing Inngest patterns
 */

import { db } from '../client.ts'
import { psiCache } from '../schema.ts'
import { eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import type { WebVitalsResult } from '@scanlyfix/checks'

// ─── Constants ─────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 6 * 60 * 60 * 1000  // 6 hours
const CLEANUP_AGE_MS = 24 * 60 * 60 * 1000  // 24 hours — delete entries older than this

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalize URL for cache key.
 * Strips trailing slash and lowercases scheme+host for consistent keys.
 */
function normalizeCacheKey(url: string): string {
  try {
    const parsed = new URL(url)
    // Strip trailing slash from pathname
    const path = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/$/, '')
    return `${parsed.protocol}//${parsed.hostname}${path}${parsed.search}${parsed.hash}`
  } catch {
    return url
  }
}

// ─── Read Cache ────────────────────────────────────────────────────────────────
/**
 * Cached PSI result dekhta hai. Agar fresh hai (< 6h) toh return karta hai.
 * null return = cache miss ya expired.
 */
export async function getCachedPsiResult(url: string): Promise<WebVitalsResult | null> {
  const key = normalizeCacheKey(url)
  const now = new Date()

  const row = await db.query.psiCache.findFirst({
    where: eq(psiCache.url, key),
  })

  if (!row) return null

  // Check expiry
  if (row.expiresAt.getTime() <= now.getTime()) {
    // Expired — delete lazily (don't block caller)
    db.delete(psiCache).where(eq(psiCache.url, key)).catch(() => {})
    return null
  }

  // Validate stored result shape
  const parsed = z.custom<WebVitalsResult>().safeParse(row.result)
  if (!parsed.success) return null

  return parsed.data
}

// ─── Write Cache ───────────────────────────────────────────────────────────────
/**
 * PSI result cache mein store karta hai with 6h TTL.
 * Upsert: agar URL already cached hai toh overwrite karo.
 */
export async function setCachedPsiResult(url: string, result: WebVitalsResult): Promise<void> {
  const key = normalizeCacheKey(url)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS)

  await db
    .insert(psiCache)
    .values({
      url: key,
      result: result as unknown as Record<string, unknown>,
      cachedAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: psiCache.url,
      set: {
        result: result as unknown as Record<string, unknown>,
        cachedAt: now,
        expiresAt,
      },
    })
}

// ─── Cleanup ───────────────────────────────────────────────────────────────────
/**
 * Expired / stale cache entries clean karta hai.
 * WHY 24h: entries older than 24h are definitely useless — even 6h TTL expired long ago.
 */
export async function cleanupOldPsiCache(): Promise<number> {
  const cutoff = new Date(Date.now() - CLEANUP_AGE_MS)

  const deleted = await db
    .delete(psiCache)
    .where(lt(psiCache.expiresAt, cutoff))
    .returning({ url: psiCache.url })

  return deleted.length
}

export { normalizeCacheKey }
