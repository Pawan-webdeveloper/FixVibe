/**
 * Turning a recorded alert into the words somebody reads.
 *
 * Pure, and kept out of alert-email.ts for the same reason billing-period.ts is
 * kept out of quota.ts: that file reaches the database and a mail provider,
 * and this is string formatting. Split, it can be tested without either — and
 * this is where the bugs actually live, because every input is a jsonb blob
 * whose shape nothing enforces.
 *
 * `alerts.kind` is text rather than an enum precisely so a new alert can ship
 * without a migration, which means render() will one day be handed a kind it
 * has never seen. It answers with a generic message rather than null: less
 * useful than a tailored one, infinitely more useful than silence.
 *
 * The prose is deliberately plain and specific. An alert is read at 3am on a
 * phone, and the reader needs the host, what happened, and one link. Anything
 * else in it is something to scroll past.
 */

import 'server-only'
import { serverEnv } from './env.ts'

export interface AlertSubject {
  kind: string
  payload: Record<string, unknown> | null
  projectName: string
  projectUrl: string
  projectSlug: string
}

export interface Rendered {
  subject: string
  text: string
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function num(payload: Record<string, unknown> | null, key: string): number | null {
  const value = payload?.[key]
  return typeof value === 'number' ? value : null
}

function str(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key]
  return typeof value === 'string' ? value : null
}

/**
 * One renderer per kind, and a fallback that still says something true.
 *
 * `alerts.kind` is text rather than an enum precisely so a new alert can ship
 * without a migration — which means this function will one day be handed a
 * kind it has never seen. Returning null there would silently drop a real
 * alert, so it renders a generic one instead: less useful than a tailored
 * message, infinitely more useful than silence.
 */
export function render(alert: AlertSubject): Rendered {
  const host = hostOf(alert.projectUrl)
  const app = serverEnv.appUrl
  const status = `${app}/status/${alert.projectSlug}`

  if (alert.kind === 'downtime') {
    const streak = num(alert.payload, 'streak') ?? 0
    const code = num(alert.payload, 'statusCode')
    const detail = str(alert.payload, 'detail')
    const observed = code !== null ? `HTTP ${code}` : (detail ?? 'no response')

    return {
      subject: `${host} is not responding`,
      text: lines([
        `${host} has failed ${streak} consecutive checks.`,
        '',
        `Observed: ${observed}`,
        `Checked:  ${alert.projectUrl}`,
        '',
        `Status page: ${status}`,
        '',
        'You will not be emailed again about this today, however long it lasts.',
      ]),
    }
  }

  if (alert.kind.startsWith('certificate-expiry')) {
    const daysLeft = num(alert.payload, 'daysLeft')
    const expired = daysLeft !== null && daysLeft < 0

    return {
      subject: expired
        ? `${host} has an expired TLS certificate`
        : `${host} certificate expires in ${daysLeft} days`,
      text: lines([
        expired
          ? `The TLS certificate for ${host} has expired. Browsers are showing a warning instead of the site.`
          : `The TLS certificate for ${host} expires in ${daysLeft} days.`,
        '',
        'If renewal is automated, confirm it ran. If it is not, this is the reminder.',
        '',
        `Site: ${alert.projectUrl}`,
        `Status page: ${status}`,
      ]),
    }
  }

  if (alert.kind === 'score-drop') {
    const before = num(alert.payload, 'before')
    const after = num(alert.payload, 'after')
    const scanId = str(alert.payload, 'scanId')
    const drop = before !== null && after !== null ? before - after : null

    return {
      subject: `${host} dropped ${drop ?? 'several'} points`,
      text: lines([
        `${host} scored ${after} on today's scan, down from ${before}.`,
        '',
        'Both scans were run by the same engine version with no degraded pillars,',
        'so this is a change on the site rather than a change in what we measure.',
        '',
        scanId ? `Report: ${app}/scan/${scanId}` : `Project: ${app}/projects`,
      ]),
    }
  }

  return {
    subject: `${host}: ${alert.kind.replace(/[-_]/g, ' ')}`,
    text: lines([
      `ScanlyFix raised a "${alert.kind}" alert for ${alert.projectName}.`,
      '',
      `Site: ${alert.projectUrl}`,
      `Status page: ${status}`,
    ]),
  }
}

function lines(parts: readonly string[]): string {
  return parts.join('\n')
}

