import { migrateDb } from '../utils/db'
import { ensureBootstrapAdmin, ensureInstanceAdminBackfill } from '../services/accounts'

export default defineNitroPlugin(async () => {
  await migrateDb()
  // F22/F31: seed the default admin when no bootstrap admin exists (no-op otherwise).
  const { seeded } = await ensureBootstrapAdmin()
  if (seeded) {
    if (process.env.BOOTSTRAP_TOKEN) {
      console.info('[teamplanner] Seeded default admin admin@teamplanner.local (no usable password yet). Complete first-run setup at /setup-admin?token=<BOOTSTRAP_TOKEN>')
    } else {
      console.warn('[teamplanner] Seeded default admin admin@teamplanner.local, but BOOTSTRAP_TOKEN is not set - first-run setup is disabled. Set BOOTSTRAP_TOKEN in the environment, restart, then visit /setup-admin?token=<BOOTSTRAP_TOKEN>')
    }
  }
  // F26: promote a pre-split bootstrap admin to instance admin (no-op otherwise).
  const { backfilled } = await ensureInstanceAdminBackfill()
  if (backfilled) {
    console.info('[teamplanner] Backfilled: bootstrap admin promoted to instance admin')
  }
})
