/**
 * Who is asking.
 *
 * Every query that can reach another account's data takes one of these. It
 * exists before there is anyone to authorize on purpose: the app connects to
 * Postgres over DATABASE_URL as the database owner, which means Supabase's
 * row-level security policies are bypassed entirely. A lot of projects assume
 * RLS is protecting them while their ORM walks straight past it.
 *
 * So authorization lives in the query layer or it does not exist. Adding the
 * parameter now, while there is one call site, is the difference between the
 * compiler enforcing it and a future audit missing the one place that forgot.
 */

export type Viewer =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'user'; readonly userId: string }

/** Convenience for the logged-out paths, which are most of Phase 2. */
export const ANONYMOUS: Viewer = { kind: 'anonymous' }
