import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Nuxt's #shared alias, for server code imported directly by tests.
      '#shared': fileURLToPath(new URL('./shared', import.meta.url))
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // DB singleton is per-process state: keep test files isolated.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000
  }
})
