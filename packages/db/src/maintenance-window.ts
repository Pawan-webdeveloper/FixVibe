/**
 * packages/db/src/maintenance-window.ts
 *
 * Maintenance window time math — pure, no DB.
 *
 * A maintenance window is "Sundays 02:00–04:00 in America/Los_Angeles". The
 * challenge is that "now" is a single instant in time, and the start time is
 * a local time that recurs in a specific IANA zone. The IANA zone matters
 * around DST transitions:
 *
 *   - On a "spring forward" Sunday, 02:00–04:00 local becomes 02:00–05:00
 *     wall-clock (the local clock skips an hour).
 *   - On a "fall back" Sunday, 02:00–04:00 local happens TWICE.
 *
 * The right tool for "the local time at this instant in this zone" is
 * Intl.DateTimeFormat with the timeZone option. It knows the rules and
 * applies them. We never use Date#getTimezoneOffset, which only knows the
 * host's local zone, and we never use a fixed offset like "-08:00", which
 * lies twice a year.
 *
 * The output is a struct with the local day-of-week, hour, minute — enough
 * to decide whether a window covers this instant without ever going back
 * to the DB.
 */

/** Local-time projection of an instant in a specific IANA zone. */
export interface LocalTime {
  /** 0 = Sunday, 6 = Saturday — matches `maintenance_windows.day_of_week`. */
  dayOfWeek: number
  /** Local hour, 0–23. */
  hour: number
  /** Local minute, 0–59. */
  minute: number
  /** Local day-of-month, 1–31 — used to disambiguate "fall back". */
  dayOfMonth: number
}

/** Cache for the Intl.DateTimeFormat objects — they are expensive to construct. */
const formatterCache = new Map<string, Intl.DateTimeFormat>()

/** WHY: avoids creating a new formatter on every probe (every minute). */
function getFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timezone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      day: 'numeric',
    })
    formatterCache.set(timezone, fmt)
  }
  return fmt
}

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

/**
 * Project an instant to a (dayOfWeek, hour, minute) tuple in the given zone.
 *
 * Pure: takes a Date or epoch ms, never reads the wall clock. Tests pass
 * synthetic instants to exercise DST boundaries.
 */
export function projectToLocal(
  instant: Date | number,
  timezone: string,
): LocalTime {
  const fmt = getFormatter(timezone)
  const parts = fmt.formatToParts(
    typeof instant === 'number' ? new Date(instant) : instant,
  )
  let dayOfWeek = -1
  let dayOfMonth = -1
  let hour = -1
  let minute = -1
  for (const part of parts) {
    if (part.type === 'weekday') {
      dayOfWeek = WEEKDAY_TO_INDEX[part.value] ?? -1
    } else if (part.type === 'day') {
      dayOfMonth = Number.parseInt(part.value, 10)
    } else if (part.type === 'hour') {
      // "24" is what some platforms emit for midnight in en-US hour12=false.
      // Normalise to 0 — 24 is not a valid hour.
      hour = Number.parseInt(part.value, 10) % 24
    } else if (part.type === 'minute') {
      minute = Number.parseInt(part.value, 10)
    }
  }
  if (
    dayOfWeek < 0 ||
    dayOfMonth < 0 ||
    hour < 0 ||
    minute < 0
  ) {
    throw new Error(`Could not project instant to zone: ${timezone}`)
  }
  return { dayOfWeek, dayOfMonth, hour, minute }
}

/** Parse a "HH:MM" or "HH:MM:SS" string to {hour, minute}. */
function parseStartTime(startTime: string): { hour: number; minute: number } {
  const parts = startTime.split(':')
  const hour = Number.parseInt(parts[0] ?? '', 10)
  const minute = Number.parseInt(parts[1] ?? '', 10)
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error(`Invalid startTime: ${startTime}`)
  }
  return { hour, minute }
}

/**
 * A single window definition, in the shape the DB returns. Pure data — no
 * Date fields, no promises — so the test file can build it without mocks.
 */
export interface MaintenanceWindowSpec {
  /** 0–6 (Sun–Sat). null = every day. */
  dayOfWeek: number | null
  /** "HH:MM" or "HH:MM:SS". The start time in `timezone` local time. */
  startTime: string
  /** Window length in minutes from `startTime`. */
  durationMin: number
  /** IANA timezone, e.g. "America/Los_Angeles". */
  timezone: string
  /**
   * Soft off-switch. Disabled windows are not enforced by the probe.
   * The DB has a `default(true)`, so the column is present in every row.
   */
  enabled: boolean
}

/**
 * Returns true when `instant` falls inside any of the window's occurrences
 * today in the window's timezone.
 *
 * The "is this instant inside a window that runs from 02:00 to 04:00 today"
 * question is what we actually need to answer. The 24-hour clock is local,
 * so we project to local, check the day-of-week matches (or is null), and
 * then check whether (hour, minute) is between start and start+duration.
 *
 * Note: this does NOT consider a window that started YESTERDAY and is still
 * running. The API caps durationMin to 1440 - startMinute, so a window
 * cannot extend past midnight in the window's timezone. That keeps the
 * math local to a single day.
 */
export function isInstantInWindow(
  instant: Date | number,
  spec: MaintenanceWindowSpec,
): boolean {
  if (!spec.enabled) return false

  const local = projectToLocal(instant, spec.timezone)
  if (spec.dayOfWeek !== null && local.dayOfWeek !== spec.dayOfWeek) {
    return false
  }

  const { hour: startHour, minute: startMinute } = parseStartTime(spec.startTime)
  const startTotal = startHour * 60 + startMinute
  const endTotal = startTotal + spec.durationMin
  const nowTotal = local.hour * 60 + local.minute

  // Window is within a single local day. `endTotal <= 1440` is enforced at
  // the API layer, so a window does not wrap past midnight. If a user sets
  // a 4h window at 23:00, that would extend to 03:00 the next day — the
  // API rejects this.
  return nowTotal >= startTotal && nowTotal < endTotal
}

