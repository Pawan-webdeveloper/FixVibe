import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

/**
 * The workspace keeps one .env at its root; Next looks for one beside the app.
 * Loading it here means the CLI, drizzle-kit and the web app all read the same
 * file, instead of three copies that drift. On a platform that injects its own
 * environment (Vercel), this finds nothing and changes nothing.
 */
config({ path: new URL('../../.env', import.meta.url).pathname, quiet: true })

/** The monorepo root — two levels up from apps/web. */
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))

const nextConfig: NextConfig = {
  /**
   * The workspace packages are published as raw TypeScript (`main: src/index.ts`)
   * and import each other with explicit `.ts` extensions, so Next has to compile
   * them rather than treat them as prebuilt dependencies.
   */
  transpilePackages: ['@scanlyfix/checks', '@scanlyfix/db'],

  /**
   * A self-contained server bundle in `.next/standalone`, for running the app
   * from a container. Vercel does not need it and ignores it; a Docker image
   * does, so it can copy the standalone output instead of the whole monorepo
   * and its node_modules.
   */
  output: 'standalone',

  /**
   * Trace file dependencies from the WORKSPACE root, not this app's directory.
   * Without it the standalone build misses the workspace packages (they live in
   * ../../packages) and the pnpm-linked node_modules above the app, and the
   * container starts with modules missing.
   */
  outputFileTracingRoot: workspaceRoot,
}

export default nextConfig
