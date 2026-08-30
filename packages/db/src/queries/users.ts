/**
 * The app's own record of a person, mirrored from the identity provider.
 *
 * The provider proves WHO is asking; this table decides what they own. The two
 * are joined on `authSubject`, never on the email — an email changes, and an
 * account keyed on one silently becomes a different account the day it does.
 *
 * `users.id` is generated here rather than copied from the provider. It was
 * once copied, from Supabase, and that made a vendor's identifier the primary
 * key of six tables — so every later provider swap is one indirection column
 * rather than a schema rewrite of every one of them.
 */

import type { Category } from '@scanlyfix/checks'
import { eq } from 'drizzle-orm'
import { db } from '../client.ts'
import { memberships, organizations, subscriptions, users } from '../schema.ts'
import type { Viewer } from './viewer.ts'

export interface AuthIdentity {
  /** The provider's stable id for this person. A Supabase UUID today. */
  subject: string
  email: string
}

/** Any transaction handle — narrowed to the two calls resolveUserId makes. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * The application user id for a sign-in, creating the row the first time.
 *
 * The subject is the provider's id and the email is the person. Both are
 * unique columns, and a returning person can arrive with a NEW subject against
 * an existing email — a Supabase UUID is stable for the lifetime of the
 * project, but a person who signs in with Google then later with GitHub
 * receives two distinct subject values for the same inbox, and the new
 * subject does not collide on `auth_subject` so a plain
 * `insert ... on conflict (auth_subject)` would hit the EMAIL unique
 * constraint and throw, locking that account out.
 *
 * So resolve by identity explicitly, in order:
 *
 *   1. Known subject — the ordinary repeat sign-in. Refresh the email, which
 *      can change upstream and is where this account's alerts are sent.
 *   2. Known email, new subject — the same person, proven again by a provider
 *      that now names them differently. Adopt the new subject; the account
 *      follows the address.
 *   3. Neither — a genuinely new person. Insert.
 *
 * Adopting a subject by email is safe precisely because there is no password:
 * every provider here (Google, GitHub, emailed code) proves control of the
 * address before it issues a subject, so a matching email IS proof of the same
 * person. The account is keyed on who can read the inbox, which is the only
 * identity this product ever had.
 */
async function resolveUserId(tx: Tx, identity: AuthIdentity): Promise<string> {
  const bySubject = await tx.query.users.findFirst({
    where: eq(users.authSubject, identity.subject),
    columns: { id: true, email: true },
  })
  if (bySubject) {
    if (bySubject.email !== identity.email) {
      await tx.update(users).set({ email: identity.email }).where(eq(users.id, bySubject.id))
    }
    return bySubject.id
  }

  const byEmail = await tx.query.users.findFirst({
    where: eq(users.email, identity.email),
    columns: { id: true },
  })
  if (byEmail) {
    await tx.update(users).set({ authSubject: identity.subject }).where(eq(users.id, byEmail.id))
    return byEmail.id
  }

  const [row] = await tx
    .insert(users)
    .values({ authSubject: identity.subject, email: identity.email })
    .returning({ id: users.id })

  if (!row) throw new Error('ensureUser: insert returned no row')
  return row.id
}

/**
 * Called on every sign-in, so it must be idempotent rather than merely
 * first-run-safe.
 *
 * A new user also gets a personal organization, an owner membership and a free
 * subscription row, in the same transaction. The organization exists from day
 * one even though there is no team UI: every query filters by organization
 * already, so "add teams later" is screens rather than a migration and a
 * backfill of every row in the database.
 */
export async function ensureUser(identity: AuthIdentity): Promise<string> {
  return db.transaction(async (tx) => {
    const userId = await resolveUserId(tx, identity)

    const existingOrg = await tx.query.organizations.findFirst({
      where: eq(organizations.ownerId, userId),
      columns: { id: true },
    })

    if (!existingOrg) {
      const [org] = await tx
        .insert(organizations)
        .values({ name: personalOrgName(identity.email), ownerId: userId })
        .returning({ id: organizations.id })

      if (org) {
        await tx
          .insert(memberships)
          .values({ orgId: org.id, userId, role: 'owner' })
          .onConflictDoNothing()
      }
    }

    // Free plan by default. Nobody reaches the payment processor until they
    // choose to, so this row exists from signup and entitlement lookups never
    // have to handle a null.
    await tx.insert(subscriptions).values({ userId }).onConflictDoNothing()

    return userId
  })
}

/**
 * The provider's id, resolved to this application's user id.
 *
 * Called on every request that needs to know who is asking, so it reads one
 * indexed column and returns one value. Null means the session is valid but
 * no app row was ever created for it — which getViewer treats as signed out
 * rather than as an error, because the repair is to send them through the
 * callback that runs ensureUser.
 */
export async function userIdForAuthSubject(subject: string): Promise<string | null> {
  const row = await db.query.users.findFirst({
    where: eq(users.authSubject, subject),
    columns: { id: true },
  })
  return row?.id ?? null
}

/** "sahil's workspace" — a placeholder name, renameable once there is a team UI. */
function personalOrgName(email: string): string {
  const local = email.split('@')[0] ?? 'personal'
  return `${local}'s workspace`
}

export interface UserContext {
  id: string
  email: string
  orgId: string
  plan: string
  /**
   * The pillars this person asked us to lead with, or null when they have
   * never been asked. Null is the signal that sends them through /welcome —
   * an empty array would mean "asked, wanted nothing", which is a different
   * answer and must not trigger the same screen twice.
   */
  priorities: Category[] | null
}

/** The identity a logged-in page needs, in one query instead of three. */
export async function getUserContext(userId: string): Promise<UserContext | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, email: true, priorities: true },
    with: {
      ownedOrganizations: { columns: { id: true }, limit: 1 },
      subscription: { columns: { plan: true } },
    },
  })
  if (!user) return null

  const orgId = user.ownedOrganizations[0]?.id
  if (!orgId) return null // ensureUser guarantees one; its absence is a bug worth surfacing

  return {
    id: user.id,
    email: user.email,
    orgId,
    plan: user.subscription?.plan ?? 'free',
    priorities: user.priorities ?? null,
  }
}

/**
 * Record what this person wants the report to lead with.
 *
 * Takes a Viewer rather than a user id for the same reason every other
 * mutation here does: the id is the thing an attacker controls, and a function
 * that accepts one directly is a function somebody will eventually call with
 * somebody else's. This writes the caller's own row and no other, which is why
 * it cannot take a target at all.
 *
 * Storing an empty array is deliberate and different from leaving it null:
 * it records that the question was asked and answered, so nobody is walked
 * through onboarding twice.
 */
export async function setUserPriorities(
  viewer: Viewer,
  priorities: readonly Category[],
): Promise<void> {
  if (viewer.kind !== 'user') return

  // De-duplicated so a malformed submission cannot store the same pillar six
  // times and skew any ordering built on the length of this array.
  const unique = [...new Set(priorities)]
  await db.update(users).set({ priorities: unique }).where(eq(users.id, viewer.userId))
}
