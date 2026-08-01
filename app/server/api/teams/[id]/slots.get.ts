import { requireUser } from '../../../utils/guards'
import { listSlots } from '../../../services/trainings'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const teamId = getRouterParam(event, 'id')!
  return listSlots(me.id, teamId)
})
