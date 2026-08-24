import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Node environment only: what is tested here is pure logic shared by the
    // client and the API route. Component behaviour is covered by the app itself.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // See test/stubs/server-only.ts — the real package throws outside an RSC
      // build, which is what makes it useful and what makes it untestable.
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
})
