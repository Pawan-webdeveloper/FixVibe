/**
 * Asking Supabase who is holding this session cookie.
 *
 * One function, one network call, and it is the entire coupling between this
 * application and its identity provider. Everything above it deals in a
 * `Viewer`; everything below it is Postgres.
 *
 * ## Why a round trip rather than reading the JWT
 *
 * The session is a JWT and its `sub` claim is the identity, so decoding it
 * locally would be free. Decoding is not verifying: the cookie is
 * attacker-supplied like any other, and an unverified claim is an
 * authorization bypass with extra steps. Verifying it properly means fetching
 * and caching Supabase's JWKS, honouring key rotation and clock skew — a
 * security-critical path this codebase would then own.
 *
 * `supabase.auth.getUser()` does exactly that. It is the call the Supabase
 * docs prescribe for authorization (their words: "use getUser() for
 * authentication, getSession() for session management") and it is what this
 * project has used in place of `getSession()` for exactly that reason.
 *
 * The cost is one call to Supabase on requests that need an identity. Requests
 * that do not — an anonymous scan, the landing page — never reach it, because
 * the cookie is checked first and its absence is answered locally.
 */

import 'server-only'
import { createClient } from '@/lib/supabase/server.ts'

export interface SupabaseIdentity {
  /** The provider's stable id. Stored as users.auth_subject. A Supabase UUID. */
  subject: string
  /**
   * Null is legitimate, not a failure: a GitHub account with a private address
   * proves an identity without exposing one. The callback asks for an address
   * only when it has to record one.
   */
  email: string | null
  name: string | null
}

export async function currentIdentity(): Promise<SupabaseIdentity | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) return null

  const user = data.user
  const fullName =
    typeof user.user_metadata?.['full_name'] === 'string' ? (user.user_metadata['full_name'] as string) : null

  return {
    subject: user.id,
    email: user.email ?? null,
    name: fullName,
  }
}
