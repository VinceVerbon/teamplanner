import { requireUser } from '../../utils/guards'
import { withdrawAbsence } from '../../services/attendance'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  return withdrawAbsence(me.id, id)
})
