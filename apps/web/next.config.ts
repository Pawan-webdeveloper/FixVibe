import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * The workspace packages are published as raw TypeScript (`main: src/index.ts`)
   * and import each other with explicit `.ts` extensions, so Next has to compile
   * them rather than treat them as prebuilt dependencies.
   */
  transpilePackages: ['@darvin/checks', '@darvin/db'],

  // typedRoutes is deliberately off until the routes it would check actually
  // exist — right now most page files are empty placeholders, so it would only
  // reject links to pages that are one commit away.
}

export default nextConfig
