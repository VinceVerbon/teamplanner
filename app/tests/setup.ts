import { migrateDb, resetDbForTests } from '../server/utils/db'

// Fresh in-memory PGlite per test file.
export async function freshDb(): Promise<void> {
  process.env.TEAMPLANNER_DATA_DIR = 'memory'
  delete process.env.DATABASE_URL
  await resetDbForTests()
  await migrateDb()
}
