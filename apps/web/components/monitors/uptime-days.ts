/**
 * Grouping uptime events into days.
 *
 * Kept out of the component so it can be tested without a JSX transform — and
 * because it is the only part of the status page with logic worth testing. A
 * strip that renders the wrong day is a status page that misleads during
 * exactly the incident it was linked for.
 */

export interface UptimeDay {
  date: string
  ok: number
  failed: number
}

/** Grouped by UTC day so the strip reads the same from every time zone. */
export function toDays(
  events: ReadonlyArray<{ ts: Date | string; ok: boolean }>,
  days = 90,
): UptimeDay[] {
  const byDay = new Map<string, { ok: number; failed: number }>()

  for (const event of events) {
    const date = (typeof event.ts === 'string' ? new Date(event.ts) : event.ts).toISOString().slice(0, 10)
    const bucket = byDay.get(date) ?? { ok: 0, failed: 0 }
    if (event.ok) bucket.ok += 1
    else bucket.failed += 1
    byDay.set(date, bucket)
  }

  return [...byDay.entries()]
    .map(([date, counts]) => ({ date, ...counts }))
    // The query returns newest-first; the strip reads left to right.
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-days)
}
