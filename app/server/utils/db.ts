import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite'
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { PGlite } from '@electric-sql/pglite'
import * as schema from '../db/schema'

export type Db = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>

let _db: Db | undefined
let _pglite: PGlite | undefined

// DATABASE_URL set -> real Postgres (prod). Unset -> embedded PGlite:
// file-backed in dev (TEAMPLANNER_DATA_DIR, default ./.data/pglite), in-memory when 'memory'.
export function getDb(): Db {
  if (_db) return _db
  const url = process.env.DATABASE_URL
  if (url) {
    _db = drizzleNodePg(url, { schema })
  } else {
    const dir = process.env.TEAMPLANNER_DATA_DIR || './.data/pglite'
    if (dir === 'memory') {
      _pglite = new PGlite()
    } else {
      mkdirSync(dir, { recursive: true }) // PGlite's own mkdir is non-recursive
      _pglite = new PGlite(dir)
    }
    _db = drizzlePglite(_pglite, { schema })
  }
  return _db
}

export async function migrateDb(): Promise<void> {
  const db = getDb()
  // Resolve from cwd, not import.meta.url: bundled server code (.nuxt/dev, .output)
  // no longer sits next to server/db/migrations.
  const folder = process.env.TEAMPLANNER_MIGRATIONS_DIR
    || join(process.cwd(), 'server', 'db', 'migrations')
  if (process.env.DATABASE_URL) {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    await migrate(db as NodePgDatabase<typeof schema>, { migrationsFolder: folder })
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator')
    await migrate(db as PgliteDatabase<typeof schema>, { migrationsFolder: folder })
  }
}

// Test hook: drop the singleton so each test file gets a fresh in-memory instance.
export async function resetDbForTests(): Promise<void> {
  if (_pglite) await _pglite.close()
  _db = undefined
  _pglite = undefined
}
