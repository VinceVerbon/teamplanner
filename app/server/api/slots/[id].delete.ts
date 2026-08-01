import { requireUser } from '../../utils/guards'
import { deleteSlot } from '../../services/trainings'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  return deleteSlot(me.id, id)
})
