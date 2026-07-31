import { requireUser } from '../../../utils/guards'
import { listTeamMembers } from '../../../services/members'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const teamId = getRouterParam(event, 'id')!
  return listTeamMembers(me.id, teamId)
})
