import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./server/db/schema.ts', './server/db/schema-knvb.ts'],
  out: './server/db/migrations'
})
