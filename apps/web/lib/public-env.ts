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
} as const
