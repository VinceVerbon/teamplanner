import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// F28 follow-up: admin-confirmed speeldagenkalender PDF sources, discovered from the
// KNVB landing page. Empty table = fall back to the built-in KNVB_SOURCES seed.
// Separate file from schema.ts only to keep parallel-session diffs apart; it is part
// of the same database schema (drizzle.config.ts lists both).
export const knvbSources = pgTable('knvb_sources', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  season: text('season').notNull(),
  region: text('region').notNull(),
  url: text('url').notNull(),
  confirmedAt: timestamp('confirmed_at').notNull().defaultNow()
})
