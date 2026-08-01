import { requireUser } from '../../utils/guards'
import { listSeasons } from '../../services/schedule'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return listSeasons()
})
