/**
 * Which month an allowance belongs to.
 *
 * Kept out of quota.ts for the same reason uptime-days.ts is kept out of its
 * component: that file reaches the database, and this is arithmetic. Split, it
 * can be tested without one — and month arithmetic is exactly where off-by-one
 * bugs live, at the December boundary and at every time zone that is not UTC.
 *
 * A calendar month rather than a rolling thirty days, and rather than the
 * subscriber's own billing anniversary. "30 scans a month" is understood by
 * everyone to reset on a date, the same date for everybody is one sentence to
 * explain, and a free account has no billing period to anchor to. The cost is
 * that somebody who subscribes on the 20th gets a short first month, which is
 * in their favour on the free tier and rounding error on the paid one.
 *
 * Everything here is UTC. A limit that resets at a different moment for each
 * customer is a support ticket nobody can reproduce.
 */

/** The first instant of the month `now` falls in. */
export function periodStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/**
 * The first instant of the following month — when the allowance comes back.
 * Date.UTC normalises month 12 into January of the next year, so December
 * needs no special case.
 */
export function periodEnd(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

/** "1 September" — the date a reader is waiting for, with no time zone to parse. */
export function resetsOn(now: Date): string {
  return periodEnd(now).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}
