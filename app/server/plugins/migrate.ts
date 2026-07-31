import { migrateDb } from '../utils/db'

export default defineNitroPlugin(async () => {
  await migrateDb()
})
