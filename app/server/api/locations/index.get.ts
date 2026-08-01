import { requireUser } from '../../utils/guards'
import { listLocations } from '../../services/schedule'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  return listLocations()
})
