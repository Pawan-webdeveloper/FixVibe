/*
 * Pure threshold evaluation — no DB, no side effects, fully testable.
 *
 * WHY alag file (not in uptime-probe.ts):
 *  - Unit test karna easy — just import and call
 *  - Future: web-vitals bhi custom thresholds use kar sakta hai
 *  - alert-message.ts mein bhi import kar sakte ho for detail strings
 */

import { z } from 'zod'

// ─── Schema ────────────────────────────────────────────────────────────────────
// WHY Zod: DB se aaya jsonb untyped hota hai — runtime validate karo
// WHY exported: API route + monitors.ts dono yahi use karein

export const AlertConfigSchema = z.object({
  /**
   * HTTP status codes that count as DOWN.
   *
   * Examples:
   *   [500, 502, 503, 504]       → 5xx only
   *   [400,401,...,599]          → any non-2xx/3xx
   *   null / undefined / []      → default: status >= 400 = down
   */
  failStatusCodes: z
    .array(z.number().int().min(100).max(599))
    .max(50)          // sanity cap — 50 status codes enough
    .optional(),

  /**
   * Max acceptable latency in ms. null = no latency threshold.
   * WHY max 60_000: a probe timeout is 15s — 60s threshold is meaningless
   */
  maxLatencyMs: z
    .number()
    .int()
    .min(100)         // below 100ms threshold is noise
    .max(60_000)
    .nullable()
    .optional(),
})

export type AlertConfig = z.infer<typeof AlertConfigSchema>

// ─── Preset Helpers ────────────────────────────────────────────────────────────
// WHY presets: UI mein dropdown options — user ne samjhana nahi padta

export const ALERT_PRESETS = {
  '5xx_only': {
    label: 'Alert on 5xx errors only',
    failStatusCodes: [500, 502, 503, 504, 507, 508, 510, 511],
  },
  '4xx_and_5xx': {
    label: 'Alert on 4xx and 5xx errors',
    failStatusCodes: Array.from({ length: 200 }, (_, i) => 400 + i),
  },
  non_200: {
    label: 'Alert on any non-200 response',
    failStatusCodes: [
      ...Array.from({ length: 99 }, (_, i) => 201 + i),   // 201-299
      ...Array.from({ length: 200 }, (_, i) => 300 + i),   // 300-499
      ...Array.from({ length: 100 }, (_, i) => 500 + i),   // 500-599
    ],
  },
  default: {
    label: 'Alert on any error (default — status ≥ 400)',
    failStatusCodes: undefined, // uses built-in logic
  },
} as const

export type AlertPresetKey = keyof typeof ALERT_PRESETS

// ─── Core Evaluator ────────────────────────────────────────────────────────────

interface RawOutcome {
  statusCode: number | null
  latencyMs: number | null
}

interface EvaluationResult {
  ok: boolean
  // WHY include reason: uptime-probe detail string mein use hoga
  reason: string | null
}

/**
 * Applies alert config thresholds to a raw probe outcome.
 *
 * WHY returns EvaluationResult (not boolean):
 * Caller needs to know WHY it failed — for detail string in monitorEvents.
 *
 * WHY null alertConfig = default behavior:
 * Existing monitors without config should behave exactly as before.
 * Backward compatible — zero migration needed for existing data.
 */
export function evaluateOutcome(
  outcome: RawOutcome,
  alertConfig: AlertConfig | null | undefined,
): EvaluationResult {
  const { statusCode, latencyMs } = outcome
  const reasons: string[] = []

  // ── Status code evaluation ──────────────────────────────────────────────────
  let statusDown = false

  if (statusCode !== null) {
    if (
      alertConfig?.failStatusCodes &&
      alertConfig.failStatusCodes.length > 0
    ) {
      // Custom threshold — only listed codes count as down
      statusDown = alertConfig.failStatusCodes.includes(statusCode)
      if (statusDown) {
        reasons.push(`HTTP ${statusCode}`)
      }
    } else {
      // Default: status >= 400 = down (existing uptime-probe behavior)
      statusDown = statusCode >= 400
      if (statusDown) {
        reasons.push(`HTTP ${statusCode}`)
      }
    }
  }

  // ── Latency evaluation ──────────────────────────────────────────────────────
  let latencyDown = false

  if (
    alertConfig?.maxLatencyMs != null &&
    latencyMs !== null &&
    latencyMs > alertConfig.maxLatencyMs
  ) {
    latencyDown = true
    reasons.push(`${latencyMs}ms > ${alertConfig.maxLatencyMs}ms threshold`)
  }

  const isDown = statusDown || latencyDown

  return {
    ok: !isDown,
    reason: reasons.length > 0 ? reasons.join(', ') : null,
  }
}

// ─── Config Validator ──────────────────────────────────────────────────────────
/**
 * Validate karta hai user-supplied alertConfig before DB mein save karo.
 * Returns parsed config or error message.
 */
export function parseAlertConfig(
  raw: unknown,
): { ok: true; config: AlertConfig } | { ok: false; reason: string } {
  const result = AlertConfigSchema.safeParse(raw)
  if (!result.success) {
    return {
      ok: false,
      reason: result.error.issues[0]?.message ?? 'Invalid alert config',
    }
  }
  return { ok: true, config: result.data }
}