import { config } from 'dotenv'
import type { NextConfig } from 'next'

/**
 * The workspace keeps one .env at its root; Next looks for one beside the app.
 * Loading it here means the CLI, drizzle-kit and the web app all read the same
 * file, instead of three copies that drift. On a platform that injects its own
 * environment (Vercel), this finds nothing and changes nothing.
 */
config({ path: new URL('../../.env', import.meta.url).pathname, quiet: true })

const nextConfig: NextConfig = {
  /**
   * The workspace packages are published as raw TypeScript (`main: src/index.ts`)
   * and import each other with explicit `.ts` extensions, so Next has to compile
   * them rather than treat them as prebuilt dependencies.
   */
  transpilePackages: ['@scanlyfix/checks', '@scanlyfix/db'],

  // typedRoutes is deliberately off until the routes it would check actually
  // exist — right now most page files are empty placeholders, so it would only
  // reject links to pages that are one commit away.
}

export default nextConfig
