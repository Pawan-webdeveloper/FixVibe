/**
 * apps/web/components/onboarding/onboarding-checks-logic.ts
 *
 * The pure, testable pieces of the checks step.
 *
 * `buildRows` and `overallVerdict` are imported by the
 * onboarding-step-checks.tsx component and exercised here in unit
 * tests. They have no React or DOM dependencies on purpose: a
 * regression in the tone thresholds or the scorecard copy is the
 * kind of change a person would notice in production and not in a
 * browser test, and the only way to catch it is with deterministic
 * assertions over the same inputs.
 *
 * Why a separate file rather than the component:
 *   - vitest is configured with `environment: 'node'` for unit
 *     tests, so a `.tsx` import fails the parser. A `.ts` file with
 *     no JSX keeps the helpers testable.
 *   - The thresholds below are decisions that belong to the spec,
 *     not to a render — keeping them here means a future "tweak the
 *     amber threshold" change does not have to read JSX to find them.
 */

export type CheckStatus = 'pending' | 'green' | 'amber' | 'red'

export interface OnboardingCheckPayload {
  url: string
  hostname: string
  uptime: {
    status: 'up' | 'down' | 'timeout' | 'error'
    latencyMs: number | null
    statusCode: number | null
    detail: string | null
  }
  ssl: {
    ok: boolean
    daysUntilExpiry: number | null
    expiresAt: string | null
    detail: string | null
  }
  domain: {
    ok: boolean
    daysUntilExpiry: number | null
    expiresAt: string | null
    detail: string | null
  }
  webVitals: {
    ok: boolean
    lcp: number | null
    cls: number | null
    detail: string | null
  }
}

export interface RowState {
  key: 'uptime' | 'ssl' | 'domain' | 'vitals'
  label: string
  status: CheckStatus
  headline: string
  detail: string | null
}

export interface OverallVerdict {
  tone: 'green' | 'amber' | 'red' | 'mixed'
  headline: string
  body: string
}

const STAGGER_MS = [0, 180, 360, 540] as const

export function buildRows(
  payload: OnboardingCheckPayload | null,
  pending: Record<string, boolean>,
): RowState[] {
  return [
    {
      key: 'uptime',
      label: 'Uptime probe',
      status: pending.uptime
        ? 'pending'
        : payload === null
          ? 'pending'
          : mapUptimeStatus(payload.uptime.status),
      headline: pending.uptime || payload === null
        ? 'Probing…'
        : uptimeHeadline(payload.uptime),
      detail: payload?.uptime.detail ?? null,
    },
    {
      key: 'ssl',
      label: 'SSL check',
      status: pending.ssl
        ? 'pending'
        : payload === null
          ? 'pending'
          : mapSslStatus(payload.ssl.ok, payload.ssl.daysUntilExpiry),
      headline: pending.ssl || payload === null
        ? 'Reading certificate…'
        : sslHeadline(payload.ssl),
      detail: payload?.ssl.detail ?? null,
    },
    {
      key: 'domain',
      label: 'Domain expiry',
      status: pending.domain
        ? 'pending'
        : payload === null
          ? 'pending'
          : mapDomainStatus(payload.domain.ok, payload.domain.daysUntilExpiry),
      headline: pending.domain || payload === null
        ? 'Looking up WHOIS…'
        : domainHeadline(payload.domain),
      detail: payload?.domain.detail ?? null,
    },
    {
      key: 'vitals',
      label: 'Web vitals (PSI)',
      status: pending.vitals
        ? 'pending'
        : payload === null
          ? 'pending'
          : mapVitalsStatus(payload.webVitals.lcp, payload.webVitals.cls, payload.webVitals.ok),
      headline: pending.vitals || payload === null
        ? 'Running Lighthouse…'
        : vitalsHeadline(payload.webVitals),
      detail: payload?.webVitals.detail ?? null,
    },
  ]
}

export function overallVerdict(rows: RowState[]): OverallVerdict {
  // Only count checks that have actually resolved. Pending rows do
  // not drag the verdict down — a slow PSI run should not flash a
  // "needs attention" banner before it has reported its number.
  const resolved = rows.filter((r) => r.status !== 'pending')
  const reds = resolved.filter((r) => r.status === 'red').length
  const ambers = resolved.filter((r) => r.status === 'amber').length
  const greens = resolved.filter((r) => r.status === 'green').length

  if (resolved.length === 0) {
    return {
      tone: 'mixed',
      headline: 'Probing your site…',
      body: 'Hold on a second while we run the four checks.',
    }
  }
  if (reds > 0) {
    return {
      tone: 'red',
      headline: `We found ${reds} thing${reds === 1 ? '' : 's'} that need${reds === 1 ? 's' : ''} attention.`,
      body:
        ambers > 0
          ? `Plus ${ambers} warning${ambers === 1 ? '' : 's'} worth watching. Monitoring every minute will catch the next thing before customers do.`
          : 'Monitoring every minute will catch the next thing before customers do.',
    }
  }
  if (ambers > 0) {
    return {
      tone: 'amber',
      headline: 'No fires, but watch the amber.',
      body:
        greens > 0
          ? `${greens} checks are green and ${ambers} need a closer look. Monitoring every minute means a slide into the red wakes you up.`
          : 'A few checks need a closer look. Monitoring every minute means a slide into the red wakes you up.',
    }
  }
  return {
    tone: 'green',
    headline: 'Everything is green.',
    body: 'Your site is up, your cert is fresh, your domain is registered, and your web vitals are healthy. We will keep watching.',
  }
}

/* -------------------------------------------------------------------------- */
/* Tone mappers                                                               */
/* -------------------------------------------------------------------------- */

function mapUptimeStatus(status: 'up' | 'down' | 'timeout' | 'error'): CheckStatus {
  if (status === 'up') return 'green'
  if (status === 'down') return 'red'
  // timeout / error — site didn't respond but we can't say it's hard down
  return 'amber'
}

function mapSslStatus(ok: boolean, days: number | null): CheckStatus {
  if (!ok) return 'red'
  if (days !== null && days < 14) return 'red'
  if (days !== null && days < 30) return 'amber'
  return 'green'
}

function mapDomainStatus(ok: boolean, days: number | null): CheckStatus {
  if (!ok) return 'red'
  if (days !== null && days < 30) return 'red'
  if (days !== null && days < 90) return 'amber'
  return 'green'
}

function mapVitalsStatus(lcp: number | null, cls: number | null, ok: boolean): CheckStatus {
  if (!ok) return 'amber'
  if (lcp === null && cls === null) return 'amber'
  // Thresholds loosely aligned with Google's "good/needs-improvement/poor".
  // LCP: good <= 2.5s, poor > 4s. CLS: good <= 0.1, poor > 0.25.
  const lcpBad = lcp !== null && lcp > 4
  const clsBad = cls !== null && cls > 0.25
  const lcpWarn = lcp !== null && lcp > 2.5
  const clsWarn = cls !== null && cls > 0.1
  if (lcpBad || clsBad) return 'red'
  if (lcpWarn || clsWarn) return 'amber'
  return 'green'
}

/* -------------------------------------------------------------------------- */
/* Headlines                                                                  */
/* -------------------------------------------------------------------------- */

function uptimeHeadline(u: OnboardingCheckPayload['uptime']): string {
  if (u.status === 'up') {
    const ms = u.latencyMs
    if (ms !== null) return `UP — ${ms}ms`
    return 'UP'
  }
  if (u.status === 'down') return `DOWN — ${u.statusCode ?? 'no response'}`
  if (u.status === 'timeout') return 'TIMEOUT'
  return 'ERROR'
}

function sslHeadline(s: OnboardingCheckPayload['ssl']): string {
  if (!s.ok) return 'Invalid certificate'
  if (s.daysUntilExpiry === null) return 'Valid'
  return `Valid — ${s.daysUntilExpiry} days`
}

function domainHeadline(d: OnboardingCheckPayload['domain']): string {
  if (!d.ok) return 'Lookup failed'
  if (d.daysUntilExpiry === null) return 'Registered'
  if (d.daysUntilExpiry < 0) return 'Expired'
  const years = Math.round(d.daysUntilExpiry / 365)
  if (years >= 1) return `Registered — ~${years} year${years === 1 ? '' : 's'} left`
  return `Registered — ${d.daysUntilExpiry} days left`
}

function vitalsHeadline(w: OnboardingCheckPayload['webVitals']): string {
  if (!w.ok) return 'PSI error'
  const parts: string[] = []
  if (w.lcp !== null) parts.push(`LCP ${w.lcp.toFixed(1)}s`)
  if (w.cls !== null) parts.push(`CLS ${w.cls.toFixed(2)}`)
  if (parts.length === 0) return 'No metrics'
  return parts.join(', ')
}

/** Exposed for callers that want to honour the same stagger (currently the JSX). */
export const REVEAL_STAGGER_MS = STAGGER_MS
