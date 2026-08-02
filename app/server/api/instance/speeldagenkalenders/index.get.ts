import { requireUser } from '../../../utils/guards'
import { listKalenders } from '../../../services/speeldagen'

/** F28: list fetched/active speeldagenkalenders (any signed-in member may look). */
export default defineEventHandler(async (event) => {
  await requireUser(event)
  return listKalenders()
})
