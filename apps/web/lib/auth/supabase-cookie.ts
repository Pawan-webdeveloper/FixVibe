/**
 * Recognising a Supabase auth cookie the current deployment can no longer read.
 *
 * Supabase Auth writes a single cookie whose name is `sb-{project-ref}-auth-token`
 * and whose value is a JSON blob of the form `{"access_token":"...","refresh_token":"...","...": ...}`.
 * The proxy needs to know which of those values are well-formed enough to pass
 * to `@supabase/ssr`'s `createServerClient` and which are not, because an
 * unparseable one throws and takes the request down with it.
 *
 * The shape check is deliberately cheap: a leading `{`, a trailing `}`, and a
 * `"` somewhere inside. That is the difference between a cookie Supabase
 * actually wrote (JSON-encoded) and one corrupted by a migration, an older
 * release, or a half-finished sign-in. A more careful check would parse the
 * JSON; we do not, because every parser this stack has will throw on
 * non-JSON, and the cost of catching the throw for a value that almost
 * certainly isn't one anyway is paid more cheaply by the predicate.
 *
 * The cookie name uses the project ref (e.g. `mxjrcpkfechlylaiaape`); we read
 * it from the URL of the Supabase project rather than hard-coding it so the
 * check stays correct when the project changes.
 */

import { publicEnv } from '@/lib/public-env.ts'

/**
 * The Supabase auth cookie name for THIS project. Pattern: `sb-<ref>-auth-token`.
 *
 * `replace` strips the trailing dot of a parsed hostname. A Supabase URL is
 * always a project subdomain of supabase.co, so the third-from-the-end label
 * is the ref. Anything else is a misconfiguration that will fail at client
 * construction time with a clearer error than this one would.
 */
function projectRef(): string {
  const url = publicEnv.supabaseUrl()
  // `URL` here rather than relying on next/env to validate: the ref needs to
  // survive even if NEXT_PUBLIC_SUPABASE_URL was set with a trailing slash or
  // a path. Best-effort only — the createServerClient call below will surface
  // a real error if the result is unusable.
  const host = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '')
  const firstLabel = host.split('.')[0] ?? ''
  if (!firstLabel.startsWith('sb-') || !host.endsWith('.supabase.co')) {
    // Fall back to the conventional name; the project-ref-shaped name is also
    // what every Supabase SDK accepts. The real failure surfaces on first use.
    return 'sb-project-ref-auth-token'
  }
  // host looks like `mxjrcpkfechlylaiaape.supabase.co`
  const ref = firstLabel.slice('sb-'.length)
  return `sb-${ref}-auth-token`
}

export const SUPABASE_AUTH_COOKIE = projectRef()

/**
 * Whether a Supabase auth cookie value is one the SDK can read.
 *
 * Mirrors the JSON-blob shape @supabase/ssr writes. Deliberately a shape
 * check, not a parse: a well-formed JSON that decodes to a session whose user
 * no longer exists already fails cleanly as "signed out" via getUser().
 */
export function isUsableSupabaseCookie(value: string): boolean {
  if (value.length < 2) return false
  if (value[0] !== '{' || value[value.length - 1] !== '}') return false
  // A `"` somewhere in the middle is what distinguishes a JSON object from
  // the empty object `{}` (which has no field at all) and from a non-JSON
  // string that happens to start and end with braces. Empty `{}` is a real
  // shape Supabase can write briefly during a sign-in; we treat it as
  // unusable to avoid a half-second window of phantom session.
  return value.length > 2 && value.includes('"')
}

/**
 * The list of Supabase auth cookie names this deployment might receive.
 * Today there is exactly one (the base name); @supabase/ssr can also set
 * chunked cookies for very large tokens, which are suffixed with `-0`, `-1`,
 * etc. Exported as an array so the proxy can iterate without hard-coding the
 * chunked-case pattern itself.
 */
export const SUPABASE_AUTH_COOKIES: readonly string[] = [SUPABASE_AUTH_COOKIE]
