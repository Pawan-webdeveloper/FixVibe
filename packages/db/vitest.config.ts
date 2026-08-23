import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // One connection pool shared by a suite that writes real rows; parallel
    // files would interleave transactions against the same tables.
    fileParallelism: false,
  },
})
