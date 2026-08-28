import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The server integration test spawns the real process and waits for it to
    // bind a port, which is slower than a unit test but is the only way to
    // exercise the auth check and the SSRF refusal on the actual HTTP surface.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
