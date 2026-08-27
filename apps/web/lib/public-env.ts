/**
 * Environment values that are safe in a browser bundle.
 *
 * Separate from lib/env.ts on purpose: that module carries `server-only`, so a
 * client component importing it fails the build. These are NEXT_PUBLIC_,
 * meaning Next inlines them into the bundle at build time — they are public by
 * definition, and a Convex deployment URL is an address, not a secret.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Add it to the root .env; see .env.example.`)
  }
  return value
}

export const publicEnv = {
  /** The Convex deployment that proves identities, e.g. https://x-y-1.convex.cloud */
  convexUrl: () => required('NEXT_PUBLIC_CONVEX_URL', process.env.NEXT_PUBLIC_CONVEX_URL),
} as const
