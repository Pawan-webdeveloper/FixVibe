/**
 * The app's own record of a person, mirrored from Supabase Auth.
 *
 * Identity has one source of truth: `users.id` is COPIED from Supabase's
 * auth.users.id rather than generated here, so the two stay joinable and there
 * is never a question of which row is the real one. No password or name
 * columns either — Supabase owns those, and a duplicated credential is a
 * liability with no upside.
 */

import { eq } from 'drizzle-orm'
import { db } from '../client.ts'
import { memberships, organizations, subscriptions, users } from '../schema.ts'

export interface AuthIdentity {
  /** Supabase auth.users.id. Never invent one here. */
  id: string
  email: string
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
export async function ensureUser(identity: AuthIdentity): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(users)
      .values({ id: identity.id, email: identity.email })
      // The email can change upstream; the id never does, so it is the target.
      .onConflictDoUpdate({ target: users.id, set: { email: identity.email } })

    const existingOrg = await tx.query.organizations.findFirst({
      where: eq(organizations.ownerId, identity.id),
      columns: { id: true },
    })

    if (!existingOrg) {
      const [org] = await tx
        .insert(organizations)
        .values({ name: personalOrgName(identity.email), ownerId: identity.id })
        .returning({ id: organizations.id })

      if (org) {
        await tx
          .insert(memberships)
          .values({ orgId: org.id, userId: identity.id, role: 'owner' })
          .onConflictDoNothing()
      }
    }

    // Free plan by default. Nobody touches Stripe until they choose to pay, so
    // this row exists from signup and entitlement lookups never handle a null.
    await tx.insert(subscriptions).values({ userId: identity.id }).onConflictDoNothing()
  })
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
}

/** The identity a logged-in page needs, in one query instead of three. */
export async function getUserContext(userId: string): Promise<UserContext | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, email: true },
    with: {
      ownedOrganizations: { columns: { id: true }, limit: 1 },
      subscription: { columns: { plan: true } },
    },
  })
  if (!user) return null

  const orgId = user.ownedOrganizations[0]?.id
  if (!orgId) return null // ensureUser guarantees one; its absence is a bug worth surfacing

  return { id: user.id, email: user.email, orgId, plan: user.subscription?.plan ?? 'free' }
}
