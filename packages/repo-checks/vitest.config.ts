import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Unit tests are network-free by design (they run on synthetic
    // RepoCheckContexts assembled from fixtures — see test/helpers.ts).
    testTimeout: 15_000,
  },
})
