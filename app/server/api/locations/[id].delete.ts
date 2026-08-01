import { requireUser } from '../../utils/guards'
import { deleteLocation } from '../../services/schedule'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  return deleteLocation(me.id, id)
})
