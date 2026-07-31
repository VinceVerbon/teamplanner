import { requireUser } from '../../../utils/guards'
import { verifyStaff } from '../../../services/members'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const assignmentId = getRouterParam(event, 'id')!
  return verifyStaff(me.id, assignmentId)
})
