/**
 * Who is signed in, as far as Convex knows.
 *
 * One query, and it is the whole bridge between the two systems. The Next.js
 * app calls it with the caller's token; Convex verifies the token and answers
 * with the identity it proves. Everything after that — plans, projects, scans
 * — is looked up in Postgres against the app's own user row.
 *
 * `subject` is the stable identifier the app stores as users.auth_subject. It
 * is deliberately what gets returned rather than the email: an email changes,
 * and an account keyed on one silently becomes a different account when it does.
 */

import { getAuthUserId } from '@convex-dev/auth/server'
import { queryGeneric } from 'convex/server'

/**
 * `queryGeneric` rather than the `query` from `./_generated/server`.
 *
 * The generated builders only exist after `npx convex dev` has run against a
 * deployment, and this repository has to typecheck and build before that — in
 * CI, in a fresh clone, and for anyone who never touches the auth deployment.
 * The generic builder is the same public API without the generated types, and
 * this schema is `authTables` alone, so there are no application tables whose
 * types we would be giving up.
 */
export const viewer = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return null

    const user = await ctx.db.get(userId)
    if (user === null) return null

    return {
      subject: userId as string,
      /**
       * Null is possible and is not an error: a GitHub account with a private
       * email address proves an identity without exposing one. The app records
       * the row either way and asks for an address when it actually needs to
       * send something.
       */
      email: user.email ?? null,
      name: user.name ?? null,
    }
  },
})
