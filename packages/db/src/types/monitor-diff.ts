/**
 * monitor-diff.ts
 *
 * Single source of truth for diff types.
 * WHY Zod: DB se aaya jsonb untyped hota hai — runtime validation
 * zaroori hai. Zod se ek hi jagah type + validation milti hai.
 */

import { z } from 'zod'

// ─── Field-level diff shape ────────────────────────────────────────────────────
// WHY generic: har field (statusCode, latencyMs, detail) ka diff
// same {from, to} shape follow karta hai — duplication avoid karta hai

const NullableIntDiff = z.object({
  from: z.number().int().nullable(),
  to: z.number().int().nullable(),
})

const NullableStrDiff = z.object({
  from: z.string().max(500).nullable(),
  to: z.string().max(500).nullable(),
})

// ─── Main Diff Schema ─────────────────────────────────────────────────────────
export const MonitorEventDiffSchema = z.object({
  statusCode: NullableIntDiff.optional(),
  latencyMs: NullableIntDiff.optional(),
  detail: NullableStrDiff.optional(),
})

// ─── Log Entry Schema (API response shape) ────────────────────────────────────
// WHY yahan define karo: API route aur frontend dono yahi import karein —
// ek hi shape, koi mismatch nahi

export const MonitorLogEntrySchema = z.object({
  id: z.string().uuid(),
  monitorId: z.string().uuid(),
  ok: z.boolean(),
  statusCode: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  detail: z.string().nullable(),
  ts: z.string().datetime(),                    // ISO string (serialized)
  diff: MonitorEventDiffSchema.nullable(),
})

export const MonitorLogsResponseSchema = z.object({
  logs: z.array(MonitorLogEntrySchema),
})

// ─── Inferred Types ───────────────────────────────────────────────────────────
export type MonitorEventDiff = z.infer<typeof MonitorEventDiffSchema>
export type MonitorLogEntry = z.infer<typeof MonitorLogEntrySchema>
export type MonitorLogsResponse = z.infer<typeof MonitorLogsResponseSchema>