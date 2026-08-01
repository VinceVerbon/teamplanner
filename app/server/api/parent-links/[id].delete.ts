import { requireUser } from '../../utils/guards'
import { removeParentLink } from '../../services/parents'

export default defineEventHandler(async (event) => {
  const me = await requireUser(event)
  const linkId = getRouterParam(event, 'id')!
  return removeParentLink(me.id, linkId)
})
