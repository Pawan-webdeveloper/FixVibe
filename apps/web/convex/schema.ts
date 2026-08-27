/**
 * The Convex deployment's schema — auth state and nothing else.
 *
 * Convex is the identity provider here and NOT the database. Every scan,
 * finding, project and subscription lives in Postgres behind @scanlyfix/db, where
 * the authorization rules are, and this deployment holds only what proving an
 * identity requires: accounts, sessions, verification codes, refresh tokens.
 *
 * That split is deliberate rather than transitional. Two data paths into the
 * same records is two places to get authorization wrong, and only one of them
 * would have been audited. Supabase was used exactly this way before Convex,
 * which is why swapping it touched five files instead of the whole product.
 */

import { defineSchema } from 'convex/server'
import { authTables } from '@convex-dev/auth/server'

export default defineSchema({
  ...authTables,
})
