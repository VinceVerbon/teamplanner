import { requireUser } from '../../utils/guards'
import { cancelInvitation } from '../../services/invitations'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const id = getRouterParam(event, 'id')!
  return cancelInvitation(me.id, id)
})
