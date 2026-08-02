import { migrateDb, resetDbForTests, getDb } from '../server/utils/db'
import { instanceAdmins } from '../server/db/schema'

// Fresh in-memory PGlite per test file.
export async function freshDb(): Promise<void> {
  process.env.TEAMPLANNER_DATA_DIR = 'memory'
  delete process.env.DATABASE_URL
  await resetDbForTests()
  await migrateDb()
}

/** F26: grant instance admin directly (createClub is instance-admin-gated). */
export async function makeInstanceAdmin(userId: string): Promise<void> {
  await getDb().insert(instanceAdmins).values({ userId })
}
