import { requireUser } from '../../utils/guards'
import { removeStaff } from '../../services/members'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const assignmentId = getRouterParam(event, 'id')!
  return removeStaff(me.id, assignmentId)
})
