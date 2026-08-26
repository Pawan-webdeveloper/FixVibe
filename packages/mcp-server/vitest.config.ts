import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Everything here is protocol framing and argument parsing — pure logic,
    // no DOM, and deliberately no live server. The API it talks to is covered
    // by apps/web's own suite.
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
