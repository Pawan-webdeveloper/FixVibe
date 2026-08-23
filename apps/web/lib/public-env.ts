/**
 * Environment values that are safe in a browser bundle.
 *
 * Separate from lib/env.ts on purpose: that module carries `server-only`, so a
 * client component importing it fails the build. These two are NEXT_PUBLIC_,
 * meaning Next inlines them into the bundle at build time — they are public by
 * definition, and the Supabase publishable key is designed to be.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Add it to the root .env; see .env.example.`)
  }
  return value
}

export const publicEnv = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseKey: () =>
    required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
} as const
