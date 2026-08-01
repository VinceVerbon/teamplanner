import { requireUser } from '../../utils/guards'
import { deleteNoTrainingPeriod } from '../../services/schedule'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  return deleteNoTrainingPeriod(me.id, id)
})
