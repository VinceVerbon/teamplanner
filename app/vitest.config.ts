import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // DB singleton is per-process state: keep test files isolated.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000
  }
})
