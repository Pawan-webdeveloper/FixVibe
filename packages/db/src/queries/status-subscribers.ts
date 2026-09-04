/**
 * Public status-page email subscribers (Phase 6.3).
 *
 * ## The shape of the table
 *
 * One row per (project, email). The token is the SAME secret for confirm
 * and unsubscribe — both links live in every email we send, and using one
 * secret rather than two means a leak cannot be split into a confirm on
 * one project + an unsubscribe on another.
 *
 * ## Idempotency
 *
 * `createStatusSubscriber` is idempotent on (projectId, normalized email):
 * the second call rotates the token (so the link in any newly-sent
 * confirmation email works) and leaves `confirmed` and `unsubscribed_at`
 * alone. The contract: re-subscribing after an unsubscribe is a no-op;
 * the original `unsubscribed_at` is preserved so the row never reactivates
 * by accident.
 *
 * ## What this file does NOT do
 *
 * It does not send mail. The render and dispatch live in
 * `apps/web/lib/status-subscriber-email.ts` so the SQL surface stays pure
 * and unit-testable, and the email-rendering surface stays swappable.
 */

import { randomBytes } from 'node:crypto'
import { and, count, eq, gte, isNull, sql } from 'drizzle-orm'
import { db } from '../client.ts'
import {
  monitors,
  projects,
  statusSubscribers,
  type StatusSubscriber,
} from '../schema.ts'

/* -------------------------------------------------------------------------- */
/* Email normalisation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Lowercases + trims an email. The schema stores it already-normalised, and
 * the unique index is on the normalised form, so this is the only thing
 * that determines "same person".
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** RFC-style email shape check — good enough to refuse obvious typos at the
 *  API edge. The mail provider's final validation is the real gate. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email)
}

/* -------------------------------------------------------------------------- */
/* Token                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 32 random bytes hex-encoded (64 chars). Unguessable on purpose: this is
 * the only credential protecting "subscribe me to this status page" and
 * "stop emailing me" — both actions anyone can take without an account.
 */
export function generateSubscriberToken(): string {
  return randomBytes(32).toString('hex')
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface CreateSubscriberInput {
  projectId: string
  email: string
  /** Salted SHA-256 of the visitor's IP from lib/request.ts. */
  ipHash: string | null
}

/**
 * Idempotent upsert. Creates the row on first call; on subsequent calls
 * rotates the token (so a freshly-sent confirmation email links to the
 * most recent click) and preserves `confirmed` + `unsubscribed_at`.
 *
 * Returns null only on an unexpected DB failure — the caller treats null
 * as "do not say success". Returns the row (inserted or updated) on success.
 */
export async function createStatusSubscriber(
  input: CreateSubscriberInput,
): Promise<StatusSubscriber | null> {
  const email = normalizeEmail(input.email)
  if (!isValidEmail(email)) return null

  const token = generateSubscriberToken()

  const [row] = await db
    .insert(statusSubscribers)
    .values({
      projectId: input.projectId,
      email,
      token,
      confirmed: false,
      ipHash: input.ipHash,
    })
    .onConflictDoUpdate({
      target: [statusSubscribers.projectId, statusSubscribers.email],
      // Rotate the token; keep confirmed flag, unsubscribed_at, and refresh
      // ipHash so re-subscribes count toward the rate limit. A user that
      // unsubscribed and re-subscribes via the form stays unconfirmed
      // until they click the new email — we never auto-reactivate.
      set: {
        token,
        confirmed: false,
        unsubscribedAt: sql`COALESCE(${statusSubscribers.unsubscribedAt}, NULL)`,
        ipHash: input.ipHash,
      },
    })
    .returning()

  return row ?? null
}

/**
 * Mark a subscriber as confirmed by token. Returns null when the token is
 * unknown OR when the row was already unsubscribed (we do not silently
 * re-subscribe somebody who clicked "stop emailing me").
 *
 * The caller (the confirm-landing page) uses the project id + slug from
 * the returned row to render the right status page.
 */
export async function confirmStatusSubscriber(
  token: string,
): Promise<{ subscriber: StatusSubscriber; project: { slug: string; name: string } } | null> {
  const [row] = await db
    .update(statusSubscribers)
    .set({ confirmed: true, confirmedAt: new Date() })
    .where(
      and(
        eq(statusSubscribers.token, token),
        isNull(statusSubscribers.unsubscribedAt),
      ),
    )
    .returning()

  if (!row) return null

  const [project] = await db
    .select({ slug: projects.slug, name: projects.name })
    .from(projects)
    .where(eq(projects.id, row.projectId))
    .limit(1)

  if (!project) return null

  return { subscriber: row, project }
}

/**
 * Soft-delete by token. Idempotent: a second call leaves the row alone.
 * Returns the project slug when found, so the unsubscribe page can show
 * "you've been removed from <Project>'s status page".
 */
export async function unsubscribeByToken(
  token: string,
): Promise<{ slug: string; name: string } | null> {
  const [row] = await db
    .update(statusSubscribers)
    .set({ unsubscribedAt: new Date() })
    .where(
      and(
        eq(statusSubscribers.token, token),
        isNull(statusSubscribers.unsubscribedAt),
      ),
    )
    .returning({ projectId: statusSubscribers.projectId })

  if (!row) return null

  const [project] = await db
    .select({ slug: projects.slug, name: projects.name })
    .from(projects)
    .where(eq(projects.id, row.projectId))
    .limit(1)

  return project ?? null
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Confirmed, active subscribers for one monitor's project.
 *
 * One row per subscriber — the caller (the email fan-out) loops and
 * sends. We do NOT batch into Resend's batch API here because the
 * unsubscribe link in each email MUST carry the per-recipient token,
 * which means each message is personalised anyway.
 *
 * Returns rows even when the subscriber list is empty (returns []), so
 * callers do not have to handle two "no recipients" shapes.
 */
export async function listConfirmedSubscribersForMonitor(
  monitorId: string,
): Promise<Array<{ id: string; email: string; token: string }>> {
  const rows = await db
    .select({
      id: statusSubscribers.id,
      email: statusSubscribers.email,
      token: statusSubscribers.token,
    })
    .from(statusSubscribers)
    .innerJoin(projects, eq(projects.id, statusSubscribers.projectId))
    .innerJoin(monitors, eq(monitors.projectId, projects.id))
    .where(
      and(
        eq(monitors.id, monitorId),
        eq(statusSubscribers.confirmed, true),
        isNull(statusSubscribers.unsubscribedAt),
      ),
    )

  return rows
}

/* -------------------------------------------------------------------------- */
/* Rate-limit support                                                          */
/* -------------------------------------------------------------------------- */

/**
 * How many subscribe attempts this visitor has made since `since`.
 * Powers the public /api/status/subscribe rate limit (5/hour).
 *
 * Counts every insert + update — idempotent re-subscribes count, by
 * design. A bot hammering the form with a known email is still a bot.
 * Counts unconfirmed rows too: the rate limit exists to stop the form
 * from being abused, not to police the address book.
 */
export async function countSubscribeAttemptsByIpSince(
  ipHash: string,
  since: Date,
): Promise<{ count: number; oldest: Date | null }> {
  const [row] = await db
    .select({
      n: count(),
      oldest: sql<Date | null>`MIN(${statusSubscribers.createdAt})`,
    })
    .from(statusSubscribers)
    .where(
      and(
        eq(statusSubscribers.ipHash, ipHash),
        gte(statusSubscribers.createdAt, since),
      ),
    )
  return { count: row?.n ?? 0, oldest: row?.oldest ?? null }
}

/* -------------------------------------------------------------------------- */
/* Project lookup (for the API route)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a project by its slug for the subscribe endpoint. Returns the
 * bare minimum the form needs (id + name + url for the confirmation email);
 * everything else stays in the DB.
 */
export async function getProjectForSubscribe(slug: string): Promise<
  { id: string; name: string; url: string; slug: string } | null
> {
  const [row] = await db
    .select({
      id: projects.id,
      name: projects.name,
      url: projects.url,
      slug: projects.slug,
    })
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1)

  return row ?? null
}
