import { requireUser } from '../utils/guards'
import { listKalenderChanges } from '../services/speeldagen'

/** F28: central changelog of processed kalender changes - visible to all clubs/staff. */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return listKalenderChanges()
})
