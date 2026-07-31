import { requireUser } from '../../../../utils/guards'
import { removePlayer } from '../../../../services/members'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const teamId = getRouterParam(event, 'id')!
  const userId = getRouterParam(event, 'userId')!
  return removePlayer(me.id, teamId, userId)
})
