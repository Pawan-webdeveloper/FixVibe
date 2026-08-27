import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Unit tests are network-free by design (they run on synthetic CheckContexts).
    // The live smoke test opts in via SCANLYFIX_LIVE=1 and gets a generous timeout.
    testTimeout: 15_000,
  },
})
