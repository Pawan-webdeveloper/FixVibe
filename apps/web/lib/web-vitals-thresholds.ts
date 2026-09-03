/**
 * web-vitals-thresholds.ts
 *
 * Google ke official Core Web Vitals thresholds define karta hai.
 * Source: https://web.dev/vitals/
 *
 * WHY alag file: thresholds business logic hai — checker ka part nahi.
 * Frontend aur backend dono yahan se import kar sakte hain.
 */

import { z } from 'zod'

// ─── Schemas ───────────────────────────────────────────────────────────────────

export const VitalKeySchema = z.enum(['lcp', 'fid', 'cls', 'fcp', 'ttfb', 'si'])
export type VitalKey = z.infer<typeof VitalKeySchema>

export const SeveritySchema = z.enum(['warn', 'critical'])
export type Severity = z.infer<typeof SeveritySchema>

export const ViolationSchema = z.object({
  key: VitalKeySchema,
  metric: z.string(),     // Human readable: "LCP", "CLS" etc
  value: z.number(),
  warn: z.number(),
  critical: z.number(),
  unit: z.string(),
  severity: SeveritySchema,
})
export type Violation = z.infer<typeof ViolationSchema>

export const VitalsInputSchema = z.object({
  lcp: z.number().nullable().optional(),
  fid: z.number().nullable().optional(),
  cls: z.number().nullable().optional(),
  fcp: z.number().nullable().optional(),
  ttfb: z.number().nullable().optional(),
  si: z.number().nullable().optional(),
})
export type VitalsInput = z.infer<typeof VitalsInputSchema>

// ─── Threshold Definitions ────────────────────────────────────────────────────
// WHY Google thresholds: industry standard — users expect these benchmarks
// warn  = "Needs Improvement" zone
// critical = "Poor" zone → immediate alert

interface ThresholdDef {
  metric: string   // display name
  warn: number
  critical: number
  unit: string
}

const THRESHOLDS: Record<VitalKey, ThresholdDef> = {
  lcp:  { metric: 'LCP',  warn: 2500,  critical: 4000,  unit: 'ms' },
  fid:  { metric: 'FID',  warn: 100,   critical: 300,   unit: 'ms' },
  cls:  { metric: 'CLS',  warn: 0.1,   critical: 0.25,  unit: ''   },
  fcp:  { metric: 'FCP',  warn: 1800,  critical: 3000,  unit: 'ms' },
  ttfb: { metric: 'TTFB', warn: 800,   critical: 1800,  unit: 'ms' },
  si:   { metric: 'SI',   warn: 3400,  critical: 5800,  unit: 'ms' },
}

// ─── Evaluator ─────────────────────────────────────────────────────────────────
/**
 * Vitals values evaluate karta hai aur violations return karta hai.
 *
 * WHY return violations array (not boolean):
 * Caller ko pata hona chahiye KAUNSA metric fail hua —
 * sirf "fail/pass" se useful alert nahi ban sakta.
 */
export function evaluateVitals(vitals: VitalsInput): {
  violations: Violation[]
  hasCritical: boolean
  hasWarn: boolean
} {
  // WHY validate: caller galat type de sakta hai — runtime mein catch karo
  const parsed = VitalsInputSchema.safeParse(vitals)
  if (!parsed.success) {
    return { violations: [], hasCritical: false, hasWarn: false }
  }

  const violations: Violation[] = []

  for (const [key, threshold] of Object.entries(THRESHOLDS) as [VitalKey, ThresholdDef][]) {
    const value = parsed.data[key]

    // null/undefined = metric missing — skip (don't false-alert)
    if (value === null || value === undefined) continue

    let severity: Severity | null = null

    if (value >= threshold.critical) {
      severity = 'critical'
    } else if (value >= threshold.warn) {
      severity = 'warn'
    }

    if (severity) {
      violations.push({
        key,
        metric: threshold.metric,
        value,
        warn: threshold.warn,
        critical: threshold.critical,
        unit: threshold.unit,
        severity,
      })
    }
  }

  // Sort: critical first, then warn
  violations.sort((a, b) => {
    if (a.severity === b.severity) return 0
    return a.severity === 'critical' ? -1 : 1
  })

  return {
    violations,
    hasCritical: violations.some((v) => v.severity === 'critical'),
    hasWarn: violations.some((v) => v.severity === 'warn'),
  }
}

// ─── Formatter ─────────────────────────────────────────────────────────────────
// WHY here: alert message + frontend dono same format use karein
export function formatVitalValue(key: VitalKey, value: number): string {
  const { unit } = THRESHOLDS[key]
  if (key === 'cls') return value.toFixed(3)
  return unit ? `${value}${unit}` : String(value)
}

export { THRESHOLDS }