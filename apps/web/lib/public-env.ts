/**
 * Environment values that are safe in a browser bundle.
 *
 * Separate from lib/env.ts on purpose: that module carries `server-only`, so a
 * client component importing it fails the build. These are NEXT_PUBLIC_,
 * meaning Next inlines them into the bundle at build time — they are public by
 * definition, and a Supabase project URL is an address, not a secret.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    // NEXT_PUBLIC_ vars are read at BUILD time, so a deploy that has not set
    // this in its environment fails the build here rather than at runtime. On a
    // host the value comes from the project's environment variables; locally it
    // comes from the root .env. See .env.example for the full list.
    throw new Error(
      `Missing ${name}. Set it in your deployment's environment variables ` +
        '(or the root .env when running locally); see .env.example.',
    )
  }
  return value
}

export const publicEnv = {
  /** The Supabase project URL, e.g. https://mxjrcpkfechlylaiaape.supabase.co */
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  /** The Supabase publishable/anon key. Public by definition; sent to the browser. */
  supabaseAnonKey: () =>
    required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  /**
   * The deployment's public URL, e.g. https://scanlyfix.com. Used by the login
   * form to build the post-OAuth redirect. Required: a localhost fallback here
   * is the silent failure mode that makes sign-in appear to work in dev and
   * break in production.
   */
  appUrl: () => required('NEXT_PUBLIC_APP_URL', process.env.NEXT_PUBLIC_APP_URL),
  /**
   * The redirect URIs this deployment will accept. Mirrors the Supabase
   * dashboard's allowlist; the login form uses it to assert a click on
   * "Continue with Google" will land somewhere the server can act on before
   * the round-trip to Google. Not a secret — already discoverable from the
   * Supabase error page on a misconfigured sign-in.
   */
  redirectAllowlist: (): readonly string[] => {
    const raw = process.env.SUPABASE_REDIRECT_ALLOWLIST
    if (!raw) return []
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) return []
    return parsed as readonly string[]
  },
} as const
