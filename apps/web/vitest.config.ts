import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Mirror next.config.ts: the workspace keeps one .env at the app root, and
// tests should see the same env the Next runtime does. Without this, a
// `required('NEXT_PUBLIC_APP_URL')` call at import time throws in the test
// process even though it would not in `next dev` or `next build`.
config({ path: fileURLToPath(new URL('./.env', import.meta.url)), quiet: true })

export default defineConfig({
  test: {
    // Node environment only: what is tested here is pure logic shared by the
    // client and the API route. Component behaviour is covered by the app itself.
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Components are imported for their pure helpers, so JSX must parse.

  },
  resolve: {
    alias: {
      // See test/stubs/server-only.ts — the real package throws outside an RSC
      // build, which is what makes it useful and what makes it untestable.
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
      // Next resolves `@/` from tsconfig paths; vitest does not read those, so
      // a module under test that imports a sibling through the alias fails to
      // load. Mirrored here rather than rewritten to relative imports, so the
      // source keeps one import style.
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
