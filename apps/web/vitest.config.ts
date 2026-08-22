import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Node environment only: what is tested here is pure logic shared by the
    // client and the API route. Component behaviour is covered by the app itself.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
