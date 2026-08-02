import { migrateDb } from '../utils/db'
import { ensureBootstrapAdmin } from '../services/accounts'

export default defineNitroPlugin(async () => {
  await migrateDb()
  // F22: on a truly fresh database, seed the default admin (no-op otherwise).
  const { seeded } = await ensureBootstrapAdmin()
  if (seeded) {
    console.info('[teamplanner] Fresh database: seeded default admin admin@teamplanner.local (set its password on first login)')
  }
})
