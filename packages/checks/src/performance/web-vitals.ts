/**
 * web-vitals.ts
 *
 * Google PageSpeed Insights API se LCP, FID, CLS, FCP, TTFB, SI fetch karta hai.
 *
 * Security:
 *  - URL validate karta hai pehle (SSRF prevention)
 *  - API key env se lata hai — hardcode nahi
 *  - 60s AbortSignal timeout (PSI slow hoti hai)
 *  - PSI response Zod se validate hota hai (no unsafe `as` cast)
 *
 * Free tier: 25,000 requests/month (key ke saath)
 */

import { z } from 'zod'

// ─── URL Validator ─────────────────────────────────────────────────────────────
// WHY: PSI API pe koi bhi URL bhej sakte hain — internal IPs block karo (SSRF)
const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])
const BLOCKED_HOST_PATTERNS = ['.local', '.internal', '.corp', '.home', '.lan']

function isValidPublicUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw)

    // Only http/https allow karo
    if (!['http:', 'https:'].includes(parsed.protocol)) return false

    const host = parsed.hostname.toLowerCase()
    if (BLOCKED_HOSTS.has(host)) return false
    if (BLOCKED_HOST_PATTERNS.some((p) => host.endsWith(p))) return false

    // Private IP ranges block karo
    // 10.x, 172.16-31.x, 192.168.x, 169.254.x (AWS metadata)
    const privateIpPattern =
      /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/
    if (privateIpPattern.test(host)) return false

    return true
  } catch {
    return false
  }
}

// ─── Zod: PSI API Response Schema ─────────────────────────────────────────────
// WHY Zod (not `as` cast): PSI response structure change ho sakti hai —
// runtime validation se unexpected nulls se crash nahi hoga
const PSIAuditSchema = z
  .object({ numericValue: z.number().optional() })
  .passthrough()

const PSIResponseSchema = z
  .object({
    lighthouseResult: z
      .object({
        audits: z
          .object({
            'largest-contentful-paint': PSIAuditSchema.optional(),
            'first-input-delay': PSIAuditSchema.optional(),
            'cumulative-layout-shift': PSIAuditSchema.optional(),
            'first-contentful-paint': PSIAuditSchema.optional(),
            'server-response-time': PSIAuditSchema.optional(),
            'speed-index': PSIAuditSchema.optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

// ─── Output Types ──────────────────────────────────────────────────────────────
export const WebVitalsResultSchema = z.object({
  ok: z.boolean(),
  lcp: z.number().nullable(),    // Largest Contentful Paint (ms)
  fid: z.number().nullable(),    // First Input Delay (ms)
  cls: z.number().nullable(),    // Cumulative Layout Shift (unitless 0-1)
  fcp: z.number().nullable(),    // First Contentful Paint (ms)
  ttfb: z.number().nullable(),   // Time to First Byte (ms)
  si: z.number().nullable(),     // Speed Index (ms)
  detail: z.string().nullable(), // Error message if ok === false
})

export type WebVitalsResult = z.infer<typeof WebVitalsResultSchema>

// ─── Constants ─────────────────────────────────────────────────────────────────
// WHY 60s: PSI Lighthouse full page load simulate karta hai — slow hoti hai
const PSI_TIMEOUT_MS = 60_000

const PSI_BASE_URL =
  'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

// ─── Main Checker ──────────────────────────────────────────────────────────────
export async function checkWebVitals(url: string): Promise<WebVitalsResult> {
  const FAILED = (detail: string): WebVitalsResult => ({
    ok: false,
    lcp: null,
    fid: null,
    cls: null,
    fcp: null,
    ttfb: null,
    si: null,
    detail,
  })

  // 1. Security: URL validate karo
  if (!isValidPublicUrl(url)) {
    return FAILED(`Blocked or invalid URL: ${url}`)
  }

  // 2. API key — env se lo, hardcode mat karo
  // WHY optional: bina key ke bhi kaam karta hai (but rate limited to ~1 req/min)
  const apiKey = process.env.PAGESPEED_API_KEY ?? ''

  const endpoint = new URL(PSI_BASE_URL)
  endpoint.searchParams.set('url', url)
  endpoint.searchParams.set('strategy', 'mobile') // mobile score = stricter = better
  endpoint.searchParams.set('category', 'performance')
  if (apiKey) endpoint.searchParams.set('key', apiKey)

  try {
    const res = await fetch(endpoint.toString(), {
      signal: AbortSignal.timeout(PSI_TIMEOUT_MS),
      headers: {
        // WHY Accept header: explicit JSON request
        Accept: 'application/json',
      },
    })

    // 3. Non-2xx handle karo
    if (!res.ok) {
      // WHY not throw: caller ko structured error chahiye, exception nahi
      const body = await res.json().catch(() => ({})) as Record<string, unknown>
      const message =
        (body?.error as { message?: string } | undefined)?.message ??
        `PSI API returned ${res.status}`
      return FAILED(message)
    }

    const raw = await res.json()

    // 4. Runtime validate — PSI response structure unpredictable hai
    const parsed = PSIResponseSchema.safeParse(raw)
    if (!parsed.success) {
      return FAILED('PSI response shape unexpected: ' + parsed.error.message)
    }

    const audits = parsed.data.lighthouseResult?.audits ?? {}

    // 5. Extract values — null agar audit missing ho
    const lcp = audits['largest-contentful-paint']?.numericValue ?? null
    const fid = audits['first-input-delay']?.numericValue ?? null
    const cls = audits['cumulative-layout-shift']?.numericValue ?? null
    const fcp = audits['first-contentful-paint']?.numericValue ?? null
    const ttfb = audits['server-response-time']?.numericValue ?? null
    const si = audits['speed-index']?.numericValue ?? null

    return {
      ok: true,
      lcp: lcp !== null ? Math.round(lcp) : null,
      fid: fid !== null ? Math.round(fid) : null,
      cls: cls !== null ? parseFloat(cls.toFixed(4)) : null, // CLS 4 decimal places
      fcp: fcp !== null ? Math.round(fcp) : null,
      ttfb: ttfb !== null ? Math.round(ttfb) : null,
      si: si !== null ? Math.round(si) : null,
      detail: null,
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return FAILED(`PSI request timed out after ${PSI_TIMEOUT_MS / 1000}s`)
    }
    return FAILED(err instanceof Error ? err.message : 'PSI request failed')
  }
}